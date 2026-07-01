// Generates Driftly PNG icons (no external deps) using zlib.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const t=Buffer.from(type);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}

// cursor polygon in a 48-unit grid
const POLY=[[14,10],[14,36],[21,29],[26,39],[30,37],[25,27],[34,27]];
function inPoly(px,py,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))c=!c;}return c;}

function makePNG(size,file){
  const px=Buffer.alloc(size*size*4);
  const rad=size*0.22; // rounded corners
  function rounded(x,y){const r=rad;const cx=Math.min(Math.max(x,r),size-r),cy=Math.min(Math.max(y,r),size-r);if(x<r&&y<r)return (x-r)**2+(y-r)**2<=r*r;if(x>size-r&&y<r)return (x-(size-r))**2+(y-r)**2<=r*r;if(x<r&&y>size-r)return (x-r)**2+(y-(size-r))**2<=r*r;if(x>size-r&&y>size-r)return (x-(size-r))**2+(y-(size-r))**2<=r*r;return true;}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const o=(y*size+x)*4;
    const inside=rounded(x+0.5,y+0.5);
    if(!inside){px[o+3]=0;continue;}
    const tdiag=(x+y)/(2*size); // 0..1 violet->teal
    let r=Math.round(124+(45-124)*tdiag);
    let g=Math.round(92+(212-92)*tdiag);
    let b=Math.round(255+(191-255)*tdiag);
    // cursor in 48-grid space
    const gx=x/size*48, gy=y/size*48;
    if(inPoly(gx,gy,POLY)){r=246;g=246;b=252;}
    // orbit dot
    if((gx-35)**2+(gy-13)**2< 3.4*3.4){r=255;g=255;b=255;}
    px[o]=r;px[o+1]=g;px[o+2]=b;px[o+3]=255;
  }
  // add filter byte 0 per row
  const raw=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;px.copy(raw,y*(size*4+1)+1,y*size*4,(y+1)*size*4);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(path.join(__dirname,file),png);
  console.log('wrote',file,png.length,'bytes');
}
makePNG(1024,'icon.png'); // ≥512 required for macOS packaging
makePNG(32,'tray.png');
