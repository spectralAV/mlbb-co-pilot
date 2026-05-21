const zones = [
  { id:"mid-river", name:"Mid River", type:"river", polygon:[[0.40,0.44],[0.60,0.44],[0.60,0.56],[0.40,0.56]], dangerWeight:0.7, connectedZones:["turtle-zone","lord-zone"] },
  { id:"turtle-zone", name:"Turtle Zone", type:"objective", polygon:[[0.58,0.55],[0.78,0.55],[0.78,0.75],[0.58,0.75]], dangerWeight:0.85, connectedZones:["mid-river"] },
  { id:"lord-zone", name:"Lord Zone", type:"objective", polygon:[[0.22,0.22],[0.42,0.22],[0.42,0.42],[0.22,0.42]], dangerWeight:0.9, connectedZones:["mid-river"] }
];
export function getZones(){ return zones; }
export function getMapRuntimeManifest(){ return { name:"MLBB Co-Pilot Map Runtime", version:"0.1", coordinateSystem:"normalized-0-1", zones:zones.length }; }
export function mapPointToZone(x:number,y:number){ return zones.find(z=>pointInPoly([x,y], z.polygon)) ?? null; }
function pointInPoly(point:number[], poly:number[][]) { let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1]; const intersect=((yi>point[1])!==(yj>point[1]))&&(point[0]<(xj-xi)*(point[1]-yi)/(yj-yi)+xi); if(intersect) inside=!inside; } return inside; }
