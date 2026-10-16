import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CalcError, ALL_UNITS,
  reconstitutionConcentration, convertUnits, dilutionC1V1, molarity, percentSolution, serialDilution,
} from './calc.js';

export const NAME = 'reconstitution-calculator';
export const VERSION = '1.0.0';
const TAIL = ' For laboratory calculations only.';
const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function wrap(fn) {
  return async (args) => {
    try {
      const result = fn(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    } catch (err) {
      const message = err instanceof CalcError ? err.message : `Unexpected error: ${err.message}`;
      return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
    }
  };
}

const num = (d) => z.number().describe(d);
const opt = (d) => z.number().optional().describe(d);

export const TOOLS = [
  {
    name: 'reconstitution_concentration',
    title: 'Reconstitution concentration',
    description: 'Concentration of a lyophilized powder after adding a diluent volume, in mg/mL and mcg/mL. Optionally gives the volume in mL and µL that holds a wanted amount.' + TAIL,
    inputSchema: {
      powder_amount: num('Mass of powder in the vial. Must be greater than 0.'),
      powder_unit: z.enum(['mg', 'mcg', 'g']).optional().describe('Unit of powder_amount. Default mg.'),
      diluent_ml: num('Volume of diluent added, in mL. Must be greater than 0.'),
      wanted_amount: opt('Optional mass you want to draw out. Must be greater than 0.'),
      wanted_unit: z.enum(['mg', 'mcg', 'g']).optional().describe('Unit of wanted_amount. Default mcg.'),
    },
    fn: reconstitutionConcentration,
  },
  {
    name: 'convert_units',
    title: 'Convert units',
    description: `Convert a value between units of the same kind: mass, volume or mass concentration. Supported units: ${ALL_UNITS.join(', ')}.` + TAIL,
    inputSchema: {
      value: num('Value to convert.'),
      from: z.string().describe('Unit to convert from, for example mg, mL or mg/mL.'),
      to: z.string().describe('Unit to convert to, of the same kind as from.'),
    },
    fn: convertUnits,
  },
  {
    name: 'dilution_c1v1',
    title: 'Dilution C1V1 = C2V2',
    description: 'Solve C1 x V1 = C2 x V2 for the single missing value. Give exactly three of c1, v1, c2, v2 in consistent units. Also returns the diluent volume to add.' + TAIL,
    inputSchema: {
      c1: opt('Stock concentration.'),
      v1: opt('Stock volume.'),
      c2: opt('Final concentration.'),
      v2: opt('Final volume.'),
    },
    fn: dilutionC1V1,
  },
  {
    name: 'molarity',
    title: 'Molarity',
    description: 'Relates mass, molarity, volume and molecular weight (mass g = M x L x g/mol). Give molarity to get the mass needed, or give mass to get the molarity.' + TAIL,
    inputSchema: {
      mw: num('Molecular weight in g/mol. Must be greater than 0.'),
      volume: num('Solution volume. Must be greater than 0.'),
      volume_unit: z.enum(['L', 'mL', 'uL', 'µL']).optional().describe('Unit of volume. Default mL.'),
      molarity: opt('Target molarity. Give this or mass, not both.'),
      molarity_unit: z.enum(['M', 'mM', 'uM', 'µM']).optional().describe('Unit of molarity. Default M.'),
      mass: opt('Mass of solute. Give this or molarity, not both.'),
      mass_unit: z.enum(['g', 'mg', 'mcg', 'ug', 'µg']).optional().describe('Unit of mass. Default g.'),
    },
    fn: molarity,
  },
  {
    name: 'percent_solution',
    title: 'Percent w/v solution',
    description: 'Grams of solute for a percent weight per volume solution (g = percent x mL / 100).' + TAIL,
    inputSchema: {
      percent_wv: num('Percent w/v, greater than 0 and at most 100.'),
      final_volume_ml: num('Final volume in mL. Must be greater than 0.'),
    },
    fn: percentSolution,
  },
  {
    name: 'serial_dilution',
    title: 'Serial dilution',
    description: 'Concentration in each tube of a serial dilution, plus the transfer and diluent volume per tube. Output concentrations use the same unit as start_conc.' + TAIL,
    inputSchema: {
      start_conc: num('Starting concentration. Must be greater than 0.'),
      factor: num('Dilution factor per step. Must be greater than 1.'),
      steps: z.number().int().describe('Number of tubes, a whole number from 1 to 20.'),
      volume_per_tube_ml: num('Final volume in each tube, in mL. Must be greater than 0.'),
    },
    fn: serialDilution,
  },
];

export function createServer() {
  const server = new McpServer({ name: NAME, version: VERSION });
  for (const t of TOOLS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: ANNOTATIONS }, wrap(t.fn));
  }
  return server;
}
