'use strict';
function sameWorkUrl(a,b){try{const first=new URL(a),second=new URL(b);return first.origin===second.origin&&first.pathname.replace(/\/$/,'')===second.pathname.replace(/\/$/,'')&&first.search===second.search;}catch{return false;}}
function reuseWorkPage({requestedUrl,platform,attempt,windowUrl,windowPlatform,windowAvailable}){return Boolean(windowAvailable&&attempt?.platform===platform&&windowPlatform===platform&&sameWorkUrl(attempt.inputUrl,requestedUrl)&&(sameWorkUrl(windowUrl,requestedUrl)||attempt.resolvedUrl&&sameWorkUrl(windowUrl,attempt.resolvedUrl)));}
module.exports={reuseWorkPage,sameWorkUrl};
