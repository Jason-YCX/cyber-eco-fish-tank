// Reproject the active tank mesh into three unused frames of the nursery turntable.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ref = require('../assets/plants/source/tiger-turntable.json');
const ctx = vm.createContext({atob});
ctx.window = ctx;
for (const file of ['vendor/three.min.js', 'assets/plants/leaf-photo-data.js', 'plant-model.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
}
const {Vector3} = ctx.THREE;
function sampleMargin(edge, x) {
  const i = edge.findIndex(v => v.x >= x);
  if (i < 1) throw Error('Requested column falls outside the projected margin');
  const a = edge[i-1], b = edge[i];
  return a.y + (b.y-a.y)*(x-a.x)/(b.x-a.x);
}
for (let form=0; form<3; form++) {
  const mesh = ctx.createAquariumPlant('tigerVallisneria',form).plant.children[0];
  if (form===0) {
    const material = mesh.material;
    if (material.side!==ctx.THREE.DoubleSide || !material.defines.AQUARIUM_TIGER_BLADE)
      throw Error('Tiger blades require their two-sided surface shader');
    const {data,width,height} = material.bumpMap.image, rgba=material.map.image.data;
    let separate=0, margin=0, center=0, samples=0;
    const column = u => Math.round(3+u*(width/4-7));
    for (let y=Math.ceil(.2*height); y<.85*height; y+=4) {
      const i=4*(y*width+column(.36));
      if (data[i]!==data[i+2] && data[i+1]!==data[i+3]) separate++;
      margin+=rgba[4*(y*width+column(.98))+3];
      center+=rgba[4*(y*width+column(.50))+3];
      samples++;
    }
    if (separate<samples/4 || (margin-center)/samples<45)
      throw Error('Reverse relief, roughness, or thin-edge transmission is missing');
  }
  const {geometry:g} = mesh, {start,lanes,rows} = g.userData.referenceTip;
  const vertex = i => new Vector3().fromBufferAttribute(g.attributes.position,i);
  const apex = vertex(start+(rows-1)*lanes);
  const first = vertex(start), last = vertex(start+lanes-1);
  const axis = apex.clone().sub(first.clone().lerp(last,.5)).normalize();
  const across = last.sub(first);
  across.addScaledVector(axis,-axis.dot(across));
  const scale = ref.sourceWidth/across.length();
  across.normalize();
  const outward = axis.clone().cross(across);
  const sourceAxis = new Vector3(...ref.axis), sourceAcross = new Vector3(...ref.cross);
  const sourceNormal = sourceAxis.clone().cross(sourceAcross);
  function referencePoint(v) {
    const offset = v.clone().sub(apex).multiplyScalar(scale);
    return sourceAxis.clone().multiplyScalar(offset.dot(axis))
      .addScaledVector(sourceAcross,offset.dot(across)).addScaledVector(sourceNormal,offset.dot(outward));
  }
  const edges = [0,lanes-1].map(lane => {
    const points = [new Vector3()];
    for (let row=rows-2; row>=0; row--) points.push(referencePoint(vertex(start+row*lanes+lane)));
    return points;
  });
  for (const v of ref.views) {
    const phi = ref.speed*(v.seconds-ref.calibrationSeconds[0]);
    const co = Math.cos(phi), si = Math.sin(phi), k = ref.inclination;
    const projected = edges.map(edge => edge.map(p => ({
      x:p.x*co+p.z*si,
      y:Math.sqrt(1-k*k)*p.y-k*p.x*si+k*p.z*co,
    })));
    const errors = [v.upper,v.lower].flatMap((margin,j) => margin.map((y,i) =>
      Math.abs(sampleMargin(projected[j],i+1)-y)));
    const mean = errors.reduce((a,b) => a+b,0)/errors.length;
    console.log(`Tiger ${form+1}, ${v.seconds}s: ${errors.length} margins, mean ${mean.toFixed(3)} source px`);
    if (!Number.isFinite(mean) || mean >= 1) process.exitCode = 1;
  }
}
