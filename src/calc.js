// Pure math for the Reconstitution Calculator. Same formulas as the browser extension popup.
// Every function validates its input and throws CalcError with a clear message on bad input.

export class CalcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalcError';
  }
}

// Round away binary float noise (1000 / 10000 stays 0.1, not 0.09999999999999999).
export const clean = (x) => Number(x.toPrecision(12));

function need(name, v, { positive = false, nonNegative = false, integer = false, min, max } = {}) {
  if (v === undefined || v === null) throw new CalcError(`${name} is required.`);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CalcError(`${name} must be a finite number.`);
  if (positive && !(v > 0)) throw new CalcError(`${name} must be greater than 0.`);
  if (nonNegative && v < 0) throw new CalcError(`${name} must be 0 or greater.`);
  if (integer && !Number.isInteger(v)) throw new CalcError(`${name} must be a whole number.`);
  if (min !== undefined && v < min) throw new CalcError(`${name} must be at least ${min}.`);
  if (max !== undefined && v > max) throw new CalcError(`${name} must be at most ${max}.`);
  return v;
}

const isGiven = (v) => v !== undefined && v !== null;

/* Units. Factors are relative to a base unit: g for mass, L for volume, g/L for mass concentration. */
export const UNITS = {
  mass: { kg: 1000, g: 1, mg: 1e-3, mcg: 1e-6, ug: 1e-6, 'µg': 1e-6, ng: 1e-9 },
  volume: { L: 1, mL: 1e-3, uL: 1e-6, 'µL': 1e-6, nL: 1e-9 },
  concentration: {
    'g/L': 1, 'mg/mL': 1, 'mg/L': 1e-3, 'mcg/mL': 1e-3, 'ug/mL': 1e-3, 'µg/mL': 1e-3,
    'mcg/L': 1e-6, 'ug/L': 1e-6, 'µg/L': 1e-6, 'ng/mL': 1e-6,
  },
};
export const ALL_UNITS = Object.values(UNITS).flatMap((t) => Object.keys(t));

function kindOf(unit) {
  for (const [kind, table] of Object.entries(UNITS)) if (Object.hasOwn(table, unit)) return kind;
  return null;
}

/* Reconstitution: concentration = powder mass / diluent volume; volume for an amount = amount / concentration */
const MASS_TO_MG = { g: 1000, mg: 1, mcg: 1e-3 };

export function reconstitutionConcentration({ powder_amount, powder_unit = 'mg', diluent_ml, wanted_amount, wanted_unit = 'mcg' }) {
  need('powder_amount', powder_amount, { positive: true });
  need('diluent_ml', diluent_ml, { positive: true });
  if (!Object.hasOwn(MASS_TO_MG, powder_unit)) throw new CalcError(`powder_unit must be one of mg, mcg, g (got "${powder_unit}").`);
  const mgPerMl = (powder_amount * MASS_TO_MG[powder_unit]) / diluent_ml;
  const out = {
    concentration_mg_per_ml: clean(mgPerMl),
    concentration_mcg_per_ml: clean(mgPerMl * 1000),
  };
  if (isGiven(wanted_amount)) {
    need('wanted_amount', wanted_amount, { positive: true });
    if (!Object.hasOwn(MASS_TO_MG, wanted_unit)) throw new CalcError(`wanted_unit must be one of mg, mcg, g (got "${wanted_unit}").`);
    const ml = (wanted_amount * MASS_TO_MG[wanted_unit]) / mgPerMl;
    out.wanted_amount = wanted_amount;
    out.wanted_unit = wanted_unit;
    out.volume_ml = clean(ml);
    out.volume_ul = clean(ml * 1000);
    if (ml > diluent_ml) out.warning = 'The requested amount is more than the total contents of the vial.';
  }
  out.summary = `Concentration = ${out.concentration_mg_per_ml} mg/mL (${out.concentration_mcg_per_ml} mcg/mL)`
    + (isGiven(out.volume_ml) ? `. Volume for ${wanted_amount} ${wanted_unit} = ${out.volume_ml} mL (${out.volume_ul} µL)` : '')
    + '.';
  return out;
}

/* Unit conversion within one kind: mass, volume or mass concentration */
export function convertUnits({ value, from, to }) {
  need('value', value);
  const kf = kindOf(from), kt = kindOf(to);
  if (!kf) throw new CalcError(`Unknown unit "${from}". Supported: ${ALL_UNITS.join(', ')}.`);
  if (!kt) throw new CalcError(`Unknown unit "${to}". Supported: ${ALL_UNITS.join(', ')}.`);
  if (kf !== kt) throw new CalcError(`Cannot convert ${kf} (${from}) to ${kt} (${to}). Both units must be the same kind.`);
  const result = clean((value * UNITS[kf][from]) / UNITS[kt][to]);
  return { kind: kf, value, from, to, result, summary: `${value} ${from} = ${result} ${to}.` };
}

/* C1V1 = C2V2: solve the one missing value */
export function dilutionC1V1({ c1, v1, c2, v2 }) {
  const f = { c1, v1, c2, v2 };
  const missing = Object.keys(f).filter((k) => !isGiven(f[k]));
  if (missing.length !== 1) throw new CalcError(`Give exactly three of c1, v1, c2, v2 and leave one out (${missing.length} missing).`);
  for (const k of Object.keys(f)) if (isGiven(f[k])) need(k, f[k], { positive: true });
  const k = missing[0];
  let r;
  if (k === 'c1') r = (c2 * v2) / v1;
  if (k === 'v1') r = (c2 * v2) / c1;
  if (k === 'c2') r = (c1 * v1) / v2;
  if (k === 'v2') r = (c1 * v1) / c2;
  if ((k === 'v1' || k === 'v2') && c2 > c1) throw new CalcError('c2 cannot be higher than c1 when diluting.');
  if ((k === 'c1' || k === 'c2') && v1 > v2) throw new CalcError('v1 cannot be larger than v2 when diluting.');
  const out = { solved_for: k, value: clean(r), c1: c1 ?? clean(r), v1: v1 ?? clean(r), c2: c2 ?? clean(r), v2: v2 ?? clean(r) };
  const finalV1 = out.v1, finalV2 = out.v2;
  out.diluent_to_add = clean(finalV2 - finalV1);
  out.summary = `${k.toUpperCase()} = ${out.value}. Take ${finalV1} of stock and add ${out.diluent_to_add} of diluent to reach ${finalV2} (same volume unit throughout).`;
  return out;
}

/* Molarity: mass (g) = M (mol/L) x V (L) x MW (g/mol) */
const VOL_TO_L = { L: 1, mL: 1e-3, uL: 1e-6, 'µL': 1e-6 };
const MOL_TO_M = { M: 1, mM: 1e-3, uM: 1e-6, 'µM': 1e-6 };
const MASS_TO_G = { g: 1, mg: 1e-3, mcg: 1e-6, ug: 1e-6, 'µg': 1e-6 };

export function molarity({ mw, volume, volume_unit = 'mL', molarity: mol, molarity_unit = 'M', mass, mass_unit = 'g' }) {
  need('mw', mw, { positive: true });
  need('volume', volume, { positive: true });
  if (!Object.hasOwn(VOL_TO_L, volume_unit)) throw new CalcError(`volume_unit must be one of ${Object.keys(VOL_TO_L).join(', ')} (got "${volume_unit}").`);
  if (!Object.hasOwn(MOL_TO_M, molarity_unit)) throw new CalcError(`molarity_unit must be one of ${Object.keys(MOL_TO_M).join(', ')} (got "${molarity_unit}").`);
  if (!Object.hasOwn(MASS_TO_G, mass_unit)) throw new CalcError(`mass_unit must be one of ${Object.keys(MASS_TO_G).join(', ')} (got "${mass_unit}").`);
  const vL = volume * VOL_TO_L[volume_unit];
  if (isGiven(mol) === isGiven(mass)) throw new CalcError('Give either molarity (to get the mass needed) or mass (to get the molarity), not both and not neither.');
  if (isGiven(mol)) {
    need('molarity', mol, { positive: true });
    const grams = mol * MOL_TO_M[molarity_unit] * vL * mw;
    const r = { solved_for: 'mass', mass_g: clean(grams), mass_mg: clean(grams * 1000), mass_in_requested_unit: clean(grams / MASS_TO_G[mass_unit]), mass_unit };
    r.summary = `Mass needed = ${r.mass_g} g (${r.mass_mg} mg) for ${mol} ${molarity_unit} in ${volume} ${volume_unit} at MW ${mw} g/mol.`;
    return r;
  }
  need('mass', mass, { positive: true });
  const molL = (mass * MASS_TO_G[mass_unit]) / mw / vL;
  const r = { solved_for: 'molarity', molarity_M: clean(molL), molarity_mM: clean(molL * 1e3), molarity_uM: clean(molL * 1e6), molarity_in_requested_unit: clean(molL / MOL_TO_M[molarity_unit]), molarity_unit };
  r.summary = `Molarity = ${r.molarity_M} M (${r.molarity_mM} mM) for ${mass} ${mass_unit} in ${volume} ${volume_unit} at MW ${mw} g/mol.`;
  return r;
}

/* Percent w/v: grams = % x mL / 100 */
export function percentSolution({ percent_wv, final_volume_ml }) {
  need('percent_wv', percent_wv, { positive: true, max: 100 });
  need('final_volume_ml', final_volume_ml, { positive: true });
  const g = (percent_wv * final_volume_ml) / 100;
  return {
    solute_g: clean(g),
    solute_mg: clean(g * 1000),
    final_volume_ml,
    summary: `Dissolve ${clean(g)} g (${clean(g * 1000)} mg) and make up to ${final_volume_ml} mL.`,
  };
}

/* Serial dilution: each tube takes V/f from the previous tube plus V - V/f diluent */
export function serialDilution({ start_conc, factor, steps, volume_per_tube_ml }) {
  need('start_conc', start_conc, { positive: true });
  need('factor', factor);
  if (!(factor > 1)) throw new CalcError('factor must be greater than 1.');
  need('steps', steps, { integer: true, min: 1, max: 20 });
  need('volume_per_tube_ml', volume_per_tube_ml, { positive: true });
  const transfer = volume_per_tube_ml / factor;
  const tubes = [];
  for (let i = 1; i <= steps; i++) tubes.push({ tube: i, concentration: clean(start_conc / Math.pow(factor, i)) });
  return {
    transfer_ml: clean(transfer),
    diluent_ml: clean(volume_per_tube_ml - transfer),
    concentrations: tubes.map((t) => t.concentration),
    tubes,
    summary: `Each tube: move ${clean(transfer)} mL from the previous tube into ${clean(volume_per_tube_ml - transfer)} mL of diluent. Concentrations: ${tubes.map((t) => t.concentration).join(', ')} (same unit as start_conc).`,
  };
}
