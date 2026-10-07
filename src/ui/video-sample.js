// MP4 metadata can live at the end of a file. Build a bounded, temporary
// first-frame sample, moving that metadata before the available media bytes.
export function mp4FrameSample(head,tail,total){
  const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength),type=(b,p)=>String.fromCharCode(...b.subarray(p+4,p+8));let p=0,mdat=-1,moov;
  while(p+8<=head.length){const n=view(head).getUint32(p);if(n<8)break;const t=type(head,p);if(t==='moov'&&p+n<=head.length)moov=head.slice(p,p+n);if(t==='mdat'){mdat=p;break;}p+=n;}
  if(mdat<0)throw new Error('当前视频格式不支持轻量封面');
  if(moov){const out=head.slice();view(out).setUint32(mdat,out.length-mdat);return out;}
  for(let i=0;i+8<=tail.length;i++){if(type(tail,i)!=='moov')continue;const size=view(tail).getUint32(i),absolute=total-tail.length+i;if(size>=8&&i+size<=tail.length&&absolute>=mdat){moov=tail.slice(i,i+size);break;}}
  if(!moov)throw new Error('视频元信息超出封面读取范围');
  const containers=new Set(['moov','trak','mdia','minf','stbl']);
  function relocate(start,end){for(let at=start;at+8<=end;){const n=view(moov).getUint32(at);if(n<8||at+n>end)throw new Error('无效的视频元信息');const t=type(moov,at);if(containers.has(t))relocate(at+8,at+n);else if(t==='stco'||t==='co64'){const v=view(moov),count=v.getUint32(at+12),stride=t==='stco'?4:8;if(at+16+count*stride>at+n)throw new Error('无效的视频偏移表');for(let i=0;i<count;i++){const off=at+16+i*stride;if(stride===4){const shifted=v.getUint32(off)+moov.length;if(shifted>0xffffffff)throw new Error('视频过大');v.setUint32(off,shifted);}else v.setBigUint64(off,v.getBigUint64(off)+BigInt(moov.length));}}at+=n;}}
  relocate(0,moov.length);const media=head.slice(mdat);view(media).setUint32(0,media.length);const out=new Uint8Array(head.length+moov.length);out.set(head.subarray(0,mdat));out.set(moov,mdat);out.set(media,mdat+moov.length);return out;
}
export function remoteFrameSource(asset,signal){return (async()=>{const parts=[];let total=0;
  for(let i=0;i<4;i++){const response=await fetch(`labmedia://frame/${asset.id}`,{signal,headers:{Range:`bytes=${i*1048576}-${(i+1)*1048576-1}`}});if(!response.ok)throw new Error('无法按需读取视频');const range=response.headers.get('content-range'),match=range?.match(/\/(\d+)$/);total=match?Number(match[1]):Number(response.headers.get('content-length'));const bytes=new Uint8Array(await response.arrayBuffer());parts.push(bytes);if(response.status!==206||!total||(i+1)*1048576>=total)break;}
  const length=parts.reduce((n,p)=>n+p.length,0),head=new Uint8Array(length);let offset=0;for(const part of parts){head.set(part,offset);offset+=part.length;}
  if(total<=head.length)return URL.createObjectURL(new Blob([head],{type:'video/mp4'}));
  const response=await fetch(`labmedia://frame/${asset.id}`,{signal,headers:{Range:`bytes=${Math.max(0,total-262144)}-${total-1}`}});if(!response.ok)throw new Error('视频元信息暂不可用');const tail=new Uint8Array(await response.arrayBuffer());return URL.createObjectURL(new Blob([mp4FrameSample(head,tail,total)],{type:'video/mp4'}));
})();}
