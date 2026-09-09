import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOTS = [
  "app",
  "components",
  "context",
  "features",
  "hooks",
  "lib",
  "shared",
];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

test("the frontend has no retired transport, URL, or compatibility surface", () => {
  const cwd = process.cwd();
  const files = SOURCE_ROOTS.flatMap((root) =>
    sourceFiles(path.resolve(cwd, root)),
  );
  // Fork psych-academy pages deliberately keep the `UnifiedWSClient` shim
  // (delegating to the v2 turn runtime) and talk to psych-academy's own
  // `/api/v1/*` mounts (companion sessions, expert packs) that live outside
  // the DeepTutor core API. Everything else must use the shared v2 client
  // and relative `/api/...` paths.
  const psychShimFiles = new Set([
    "lib/unified-ws.ts",
    // Contract owner of the `/home?capability=…` launch URL — the surface
    // itself stays deleted, only this builder/reader pair remains.
    "lib/chat-launch-intent.ts",
    // Academy shortcuts fall back to `/home` for surfaces without a
    // dedicated page — the only remaining writer of that URL.
    "lib/psych-academy-shortcuts.ts",
    "app/(workspace)/counsel/page.tsx",
    "app/(workspace)/distill/page.tsx",
    "app/(workspace)/observe/page.tsx",
    "app/(workspace)/intake/page.tsx",
    "app/(workspace)/dual/page.tsx",
    "app/(workspace)/sim/page.tsx",
    "app/(workspace)/companion/page.tsx",
    "lib/expert-packs-api.ts",
  ]);
  const forbidden = [
    /\/api\/v1(?:\/|["'`])/,
    /\/api\/(?:attachments|book|co_writer|knowledge|learning|notebook|outputs)(?:\/|["'`])/,
    /["'`]\/(?:book|home|knowledge|notebook|study)(?:[/?#"'`]|$)/,
    /\?session=/,
    /UnifiedWSClient/,
    /lib\/unified-ws/,
    /features\/chat\/compat\/UnifiedChatFacade/,
  ];

  for (const file of files) {
    if (psychShimFiles.has(path.relative(cwd, file))) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(cwd, file)} contains ${pattern}`,
      );
    }
  }

  // The shim file itself may reference the shim's own surface, but it must
  // still delegate to the v2 runtime, never carry a v1 socket of its own.
  const shimSource = fs.readFileSync(
    path.resolve(cwd, "lib/unified-ws.ts"),
    "utf8",
  );
  assert.match(shimSource, /UnifiedTurnClient/);
  assert.doesNotMatch(shimSource, /new WebSocket/);

  for (const relative of [
    "lib/unified-ws-recovery.ts",
    "components/chat/home/ChatMessages.tsx",
    "components/chat/home/TracePanels.tsx",
    "lib/chat-capabilities.ts",
    "lib/capabilities-api.ts",
    "lib/settings-nav.ts",
    "app/api/v1",
    "app/(workspace)/home",
    "app/(workspace)/book",
    "app/(utility)/knowledge",
    "app/(utility)/notebook",
    "app/(utility)/space/notebooks/page.tsx",
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(cwd, relative)),
      false,
      `${relative} must stay deleted`,
    );
  }
});

test("all chat entry points share the validated v2 runtime", () => {
  const adapter = fs.readFileSync(
    path.resolve(process.cwd(), "features/chat/transport/UnifiedTurnClient.ts"),
    "utf8",
  );
  assert.match(adapter, /TurnRuntimeClient/);
  assert.match(adapter, /protocol_version: "2\.0"/);
});
