import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

interface SearchResult {
  name: string;
  path: string;
  size: string;
  modified: string;
  kind: "file" | "folder";
}

// ── PowerShell Helpers ───────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 15_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── Windows Search via OleDB ─────────────────────────────────

async function searchFiles(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const escapedQuery = query.replace(/'/g, "''");

  // Use Windows Search indexer via OleDB provider
  const script = `
$conn = New-Object System.Data.OleDb.OleDbConnection
$conn.ConnectionString = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows'"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP ${maxResults} System.ItemName, System.ItemPathDisplay, System.Size, System.DateModified, System.ItemType FROM SystemIndex WHERE System.ItemName LIKE '%${escapedQuery}%' ORDER BY System.DateModified DESC"
$reader = $cmd.ExecuteReader()
$results = @()
while ($reader.Read()) {
  $name = if ($reader[0] -ne [DBNull]::Value) { $reader[0] } else { "" }
  $path = if ($reader[1] -ne [DBNull]::Value) { $reader[1] } else { "" }
  $size = if ($reader[2] -ne [DBNull]::Value) { [math]::Round($reader[2]/1KB, 1) } else { 0 }
  $mod = if ($reader[3] -ne [DBNull]::Value) { ([datetime]$reader[3]).ToString("yyyy-MM-dd HH:mm") } else { "" }
  $type = if ($reader[4] -ne [DBNull]::Value) { $reader[4].ToString() } else { "" }
  $kind = if ($type -eq "Directory") { "folder" } else { "file" }
  $results += "$name|$path|$size|$mod|$kind"
}
$reader.Close()
$conn.Close()
$results -join "\\n"
`.trim();

  try {
    const raw = await runPs(script);
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const [name, path, size, modified, kind] = line.split("|");
      return {
        name: name ?? "",
        path: path ?? "",
        size: size ? `${size}KB` : "N/A",
        modified: modified ?? "",
        kind: (kind as "file" | "folder") ?? "file",
      };
    });
  } catch {
    return [];
  }
}

// ── Fallback: dir-based search ──────────────────────────────

async function searchFilesFallback(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const escapedQuery = query.replace(/'/g, "''");

  const script = `
Get-ChildItem -Path $env:USERPROFILE -Recurse -Depth 4 -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*${escapedQuery}*' } |
  Select-Object -First ${maxResults} |
  ForEach-Object {
    $size = if ($_.PSIsContainer) { 0 } else { [math]::Round($_.Length/1KB, 1) }
    $kind = if ($_.PSIsContainer) { "folder" } else { "file" }
    "$($_.Name)|$($_.FullName)|$size|$($_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))|$kind"
  }
`.trim();

  try {
    const raw = await runPs(script);
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const [name, path, size, modified, kind] = line.split("|");
      return {
        name: name ?? "",
        path: path ?? "",
        size: size ? `${size}KB` : "N/A",
        modified: modified ?? "",
        kind: (kind as "file" | "folder") ?? "file",
      };
    });
  } catch {
    return [];
  }
}

// ── Combined search ─────────────────────────────────────────

async function search(query: string, maxResults: number): Promise<SearchResult[]> {
  // Try Windows Search indexer first, fall back to dir scan
  const results = await searchFiles(query, maxResults);
  if (results.length > 0) return results;
  return searchFilesFallback(query, maxResults);
}

// ── Formatting ──────────────────────────────────────────────

function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No files found matching "${query}".`;
  }

  const header = `Found ${results.length} result(s) for "${query}":\n`;
  const lines = results.map((r, i) => {
    const icon = r.kind === "folder" ? "[DIR]" : "[FILE]";
    return `${i + 1}. ${icon} ${r.name}\n   ${r.path}\n   ${r.size} | ${r.modified}`;
  });

  return header + lines.join("\n");
}

function formatHelp(): string {
  return [
    "Windows File Search commands:",
    "",
    "/search <query> — Search files and folders by name",
    "/search recent — Show recently modified files",
    "/search ext:<extension> <query> — Search by file extension (e.g., ext:pdf report)",
  ].join("\n");
}

// ── Extension-filtered search ───────────────────────────────

async function searchByExtension(
  ext: string,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const escapedExt = ext.replace(/'/g, "''");
  const escapedQuery = query.replace(/'/g, "''");

  const script = `
$conn = New-Object System.Data.OleDb.OleDbConnection
$conn.ConnectionString = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows'"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP ${maxResults} System.ItemName, System.ItemPathDisplay, System.Size, System.DateModified, System.ItemType FROM SystemIndex WHERE System.ItemName LIKE '%${escapedQuery}%' AND System.FileExtension = '.${escapedExt}' ORDER BY System.DateModified DESC"
$reader = $cmd.ExecuteReader()
$results = @()
while ($reader.Read()) {
  $name = if ($reader[0] -ne [DBNull]::Value) { $reader[0] } else { "" }
  $path = if ($reader[1] -ne [DBNull]::Value) { $reader[1] } else { "" }
  $size = if ($reader[2] -ne [DBNull]::Value) { [math]::Round($reader[2]/1KB, 1) } else { 0 }
  $mod = if ($reader[3] -ne [DBNull]::Value) { ([datetime]$reader[3]).ToString("yyyy-MM-dd HH:mm") } else { "" }
  $results += "$name|$path|$size|$mod|file"
}
$reader.Close()
$conn.Close()
$results -join "\\n"
`.trim();

  try {
    const raw = await runPs(script);
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const [name, path, size, modified, kind] = line.split("|");
      return {
        name: name ?? "",
        path: path ?? "",
        size: size ? `${size}KB` : "N/A",
        modified: modified ?? "",
        kind: (kind as "file" | "folder") ?? "file",
      };
    });
  } catch {
    return [];
  }
}

// ── Recent files ────────────────────────────────────────────

async function getRecentFiles(maxResults: number): Promise<SearchResult[]> {
  const script = `
$conn = New-Object System.Data.OleDb.OleDbConnection
$conn.ConnectionString = "Provider=Search.CollatorDSO;Extended Properties='Application=Windows'"
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT TOP ${maxResults} System.ItemName, System.ItemPathDisplay, System.Size, System.DateModified, System.ItemType FROM SystemIndex WHERE System.ItemType <> 'Directory' AND SCOPE='file:$env:USERPROFILE' ORDER BY System.DateModified DESC"
$reader = $cmd.ExecuteReader()
$results = @()
while ($reader.Read()) {
  $name = if ($reader[0] -ne [DBNull]::Value) { $reader[0] } else { "" }
  $path = if ($reader[1] -ne [DBNull]::Value) { $reader[1] } else { "" }
  $size = if ($reader[2] -ne [DBNull]::Value) { [math]::Round($reader[2]/1KB, 1) } else { 0 }
  $mod = if ($reader[3] -ne [DBNull]::Value) { ([datetime]$reader[3]).ToString("yyyy-MM-dd HH:mm") } else { "" }
  $results += "$name|$path|$size|$mod|file"
}
$reader.Close()
$conn.Close()
$results -join "\\n"
`.trim();

  try {
    const raw = await runPs(script);
    if (!raw) return [];

    return raw.split("\n").filter(Boolean).map((line) => {
      const [name, path, size, modified] = line.split("|");
      return {
        name: name ?? "",
        path: path ?? "",
        size: size ? `${size}KB` : "N/A",
        modified: modified ?? "",
        kind: "file" as const,
      };
    });
  } catch {
    return [];
  }
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "win-file-search",
  name: "Windows File Search",
  description: "Fast file and folder search on Windows using Windows Search indexer",
  register(api: OpenClawPluginApi) {
    const maxResults = 20;

    api.registerCommand({
      name: "search",
      description: "Search files and folders on Windows (search, recent, ext:type filter).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";

        if (!args || args === "help") {
          return { text: formatHelp() };
        }

        // /search recent
        if (args.toLowerCase() === "recent") {
          const results = await getRecentFiles(maxResults);
          return { text: formatResults(results, "recent files") };
        }

        // /search ext:pdf report
        const extMatch = args.match(/^ext:(\w+)\s+(.+)$/i);
        if (extMatch) {
          const [, ext, query] = extMatch;
          const results = await searchByExtension(ext!, query!, maxResults);
          return { text: formatResults(results, `${ext} files matching "${query}"`) };
        }

        // /search <query>
        const results = await search(args, maxResults);
        return { text: formatResults(results, args) };
      },
    });
  },
});
