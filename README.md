# Cloud's CAD for Claude (MCP plug-in)

Lets **your own Claude** (Claude Desktop or Claude Code) run Cloud's CAD's engine on files on your computer.
Free, GPL v3. Runs locally; it only touches files you name, and never overwrites unless you say so.

## What you can ask Claude
- "Check this DXF and tell me if it's ready to cut."
- "Turn profile.dxf into a .tap, 4 inches wide."
- "What's in this .tap file?"  /  "Turn this .tap back into a DXF."
- "Get the front outline of crown.stl at 6 inches long and make a .tap."
- "Slice this model 1 inch up from the bottom."

## Install (needs Node.js 18+, nodejs.org)
1. Put `clouds-cad-mcp.mjs` somewhere permanent, e.g. `C:\CloudsCAD\clouds-cad-mcp.mjs`.
2. **Claude Desktop:** Settings > Developer > Edit Config, add:
```json
{ "mcpServers": { "clouds-cad": { "command": "node", "args": ["C:\\CloudsCAD\\clouds-cad-mcp.mjs"] } } }
```
Restart Claude Desktop.
3. **Claude Code:** `claude mcp add clouds-cad -- node /path/to/clouds-cad-mcp.mjs`

## Build from source
`cd mcp && npm install && node build.mjs` (output: `dist/clouds-cad-mcp.mjs`). `node test.mjs` runs a check.

## Honest limits
Output matches the shop's BobCAD dialect (header/footer copied verbatim, no G00). Not yet tested on the real machine: do a dry run first.
