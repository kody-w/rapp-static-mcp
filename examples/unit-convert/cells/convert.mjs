// unit-convert cell — pure, portable, content-addressed.
const LEN = { m:1, km:1000, cm:0.01, mm:0.001, mi:1609.344, yd:0.9144, ft:0.3048, in:0.0254 };
const MASS = { g:1, kg:1000, mg:0.001, lb:453.59237, oz:28.349523125, t:1e6 };
const dimOf = (u) => u in LEN ? "length" : u in MASS ? "mass" : /^(c|f|k)$/.test(u) ? "temperature" : null;
function toC(v,u){ return u==="c"?v : u==="f"?(v-32)*5/9 : v-273.15; }
function fromC(v,u){ return u==="c"?v : u==="f"?v*9/5+32 : v+273.15; }
export async function convert({ value, from, to } = {}) {
  from=String(from).toLowerCase(); to=String(to).toLowerCase();
  const d1=dimOf(from), d2=dimOf(to);
  if(!d1||!d2) throw new Error(`unknown unit: ${!d1?from:to}`);
  if(d1!==d2) throw new Error(`incompatible dimensions: ${d1} → ${d2}`);
  let out;
  if(d1==="temperature") out = fromC(toC(value,from),to);
  else { const T=d1==="length"?LEN:MASS; out = value*T[from]/T[to]; }
  return { value, from, to, dimension:d1, result: Math.round(out*1e9)/1e9 };
}
export async function units(){ return {
  length: Object.keys(LEN), mass: Object.keys(MASS), temperature: ["c","f","k"] }; }
