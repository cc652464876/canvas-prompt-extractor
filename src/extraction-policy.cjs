'use strict';
function popupAction(value,requestedUrl){
  try{
    const url=new URL(value),requested=new URL(requestedUrl);
    if(url.protocol!=='https:')return 'deny';
    if(url.hostname===requested.hostname&&/^\/(?:canvas|ai-canvas)(?:\/|$)/.test(url.pathname))return 'canvas';
    // Authentication may genuinely require a separate window. Other popups are
    // unnecessary for reading and must not steal the controlled page.
    if(/(?:^|[./_-])(?:login|signin|oauth|authorize|passport|sso|auth)(?:[./_-]|$)/i.test(url.hostname+url.pathname))return 'auth';
    return 'deny';
  }catch{return 'deny';}
}
function leftRequestedWork(value,requestedUrl){
  try{
    const url=new URL(value),requested=new URL(requestedUrl);
    if(!/(^|\.)liblib\.tv$/.test(requested.hostname)||!requested.pathname.startsWith('/detail/'))return false;
    const pagePath=url.pathname.replace(/\/$/,'')||'/';
    const workPath=requested.pathname.replace(/\/$/,'');
    return /(^|\.)liblib\.tv$/.test(url.hostname)&&
      (pagePath==='/'||pagePath==='/home'||pagePath.startsWith('/detail/')&&pagePath!==workPath);
  }catch{return false;}
}
module.exports={popupAction,leftRequestedWork};
