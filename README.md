# Reconstitution Calculator MCP Server

A small Model Context Protocol server with six lab math tools. Pure math, no network calls, no data stored. Same formulas as the Reconstitution Calculator browser extension.

Made by [Peptara Labs](https://www.peptaralabs.io) ([peptaralabs.io](https://www.peptaralabs.io))

## Tools

| Tool | What it does | Inputs |
| --- | --- | --- |
| `reconstitution_concentration` | Concentration after adding diluent to a powder, in mg/mL and mcg/mL, plus the volume in mL and µL that holds a wanted amount | `powder_amount`, `powder_unit` (mg, mcg, g), `diluent_ml`, optional `wanted_amount`, `wanted_unit` |
| `convert_units` | Converts mass, volume or mass concentration units | `value`, `from`, `to` |
| `dilution_c1v1` | Solves C1V1 = C2V2 for the one missing value and gives the diluent volume to add | any three of `c1`, `v1`, `c2`, `v2` |
| `molarity` | Mass needed for a molarity, or molarity from a mass | `mw`, `volume`, `volume_unit`, then `molarity` and `molarity_unit` or `mass` and `mass_unit` |
| `percent_solution` | Grams of solute for a percent w/v solution | `percent_wv`, `final_volume_ml` |
| `serial_dilution` | Concentration in each tube, plus transfer and diluent volume per tube | `start_conc`, `factor`, `steps` (1 to 20), `volume_per_tube_ml` |

Supported units for `convert_units`:

* Mass: kg, g, mg, mcg, ug, µg, ng
* Volume: L, mL, uL, µL, nL
* Mass concentration: g/L, mg/mL, mg/L, mcg/mL, ug/mL, µg/mL, mcg/L, ug/L, µg/L, ng/mL

Every tool checks its input. A bad value (a zero volume, a unit of the wrong kind, too many blanks) returns a clear error instead of a number.

## Install

Requires Node.js 18 or newer.

Run it with npx:

```bash
npx -y reconstitution-calculator-mcp
```

Or run it from a local copy:

```bash
npm install
npm start
```

## Claude Desktop config

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reconstitution-calculator": {
      "command": "npx",
      "args": ["-y", "reconstitution-calculator-mcp"]
    }
  }
}
```

From a local copy, point `command` at Node instead:

```json
{
  "mcpServers": {
    "reconstitution-calculator": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/src/index.js"]
    }
  }
}
```

## Streamable HTTP

The server speaks stdio by default. Add `--http` to serve Streamable HTTP at `/mcp` (stateless, JSON responses):

```bash
node src/index.js --http --port 8081 --host 127.0.0.1
```

`PORT`, `HOST` and `TRANSPORT=http` work as environment variables too. `GET /status` returns a status line. The included `Dockerfile` and `smithery.yaml` run the HTTP mode in a container for remote hosting.

## Example

Input to `reconstitution_concentration`:

```json
{ "powder_amount": 10, "powder_unit": "mg", "diluent_ml": 2, "wanted_amount": 250, "wanted_unit": "mcg" }
```

Result: 5 mg/mL (5000 mcg/mL), and 250 mcg is in 0.05 mL (50 µL).

## Tests

```bash
npm test
```

The test starts the server over stdio and over HTTP with the MCP SDK client, lists the tools, checks known answers for each tool, and runs one bad input per tool that must return an error.

## License

MIT. For laboratory calculations only.
