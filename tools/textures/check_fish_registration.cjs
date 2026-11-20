// Report vertical silhouette error against side-photo stations omitted from the mesh fit.
// Use the photo coordinate system of build_fish_photos.py (800px reference, except
// guppyLace uses its native 499px source). These points measure the trunk, not fins.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
global.window = global;
require('node:vm').runInThisContext(require('node:fs').readFileSync(path.join(root, 'vendor/three.min.js'), 'utf8'));
require(path.join(root, 'assets/fish/fish-photo-data.js'));
require(path.join(root, 'fish-species.js'));

const checks = {
  guppy: { frame:[142,949,394], points:[
    [520,349,434],[575,336,427],[690,315,445],[770,322,446],[845,340,439],[922,370,410]] },
  guppyLace: { frame:[42,341,149], points:[
    [179,130,169],[201,128,169],[224,126,172],[248,123,174],[268,124,173],[326,128,162]] },
  pandaCory: { frame:[280,593,274], points:[
    [386,240,282],[419,235,293],[452,223,301],[489,223,302],[540,234,305],[563,245,297]] },
  otocinclus: { frame:[1,740,214], points:[
    [191,182,255],[279,163,246],[379,140,243],[498,127,248],[571,135,250],[692,190,245]] },
};

function measure(species, { frame:[left,right,baseline], points }) {
  const { animated } = aquariumFishSpecies.makeTemplate(species === 'guppyLace' ? 'guppy' : species, species === 'guppyLace' ? 1 : 0, mesh => mesh);
  const p = animated.find(m => m.name === 'AquariumFishBody').geometry.getAttribute('position');
  const scale = right - left;
  // Collect vertices of each actual ring. The emitted mesh includes its physical scale relief.
  const rings = new Map();
  for (let i=0; i<p.count; i++) {
    const x = left + (p.getZ(i)+.5)*scale;
    const y = baseline - p.getY(i)*scale;
    const old = rings.get(x) || [Infinity,-Infinity];
    rings.set(x, [Math.min(old[0],y),Math.max(old[1],y)]);
  }
  const xs = [...rings.keys()].sort((a,b)=>a-b);
  const errors = [];
  for (const [x,...target] of points) {
    const j = xs.findIndex(u=>u>=x), a=xs[j-1], b=xs[j], t=(x-a)/(b-a);
    for(let k=0; k<2; k++) {
      const projection = THREE.MathUtils.lerp(rings.get(a)[k], rings.get(b)[k], t);
      errors.push(Math.abs(projection-target[k]));
    }
  }
  return {stations:points.length,mean:+(errors.reduce((a,b)=>a+b,0)/errors.length).toFixed(2),
    maximum:+Math.max(...errors).toFixed(2)};
}
const results = Object.fromEntries(Object.entries(checks).map(([species,test])=>[species,measure(species,test)]));
console.log(JSON.stringify(results,null,2));
if (Object.values(results).some(r=>r.maximum>7)) process.exitCode=1;
