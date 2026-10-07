'use strict';
const {normalizePreference}=require('./theme.cjs');
const {normalizeTypography}=require('./typography.cjs');
const UI_SETTING_KEYS=['appearance-v1','theme','prompt-typography-v1','columns','read-layout'];

// Retain only application preferences, never arbitrary website storage.
function keepUiSettings(input={}) {
  const result={};
  for(const key of UI_SETTING_KEYS){
    const value=input?.[key];if(typeof value!=='string'||value.length>1024)continue;
    try{
      if(key==='appearance-v1')result[key]=JSON.stringify(normalizePreference(JSON.parse(value)));
      else if(key==='prompt-typography-v1')result[key]=JSON.stringify(normalizeTypography(JSON.parse(value)));
      else if(key==='theme'&&['light','dark'].includes(value))result[key]=value;
      else if(key==='columns'&&/^(?:[1-9]|10|11)$/.test(value))result[key]=value;
      else if(key==='read-layout'&&['side','stack','dual'].includes(value))result[key]=value;
    }catch{}
  }
  return result;
}
async function resetBrowserData({sessions,settings,closePages,clearThumbnails,restoreSettings}) {
  const retained=keepUiSettings(settings);
  await closePages();
  let failure;
  try{
    const outcomes=await Promise.allSettled([...new Set(sessions)].map(async ses=>{
      // No origin filter: include login providers, third-party resources and any
      // other sites in every session, not just the two supported platform hosts.
      await ses.closeAllConnections();
      await ses.clearData();
      await ses.clearCache();
      await ses.clearCodeCaches({urls:[]});
      await ses.clearAuthCache();
      await ses.clearHostResolverCache();
      await ses.clearSharedDictionaryCache();
      await ses.closeAllConnections();
    }));
    if(outcomes.some(outcome=>outcome.status==='rejected'))failure=new Error('部分浏览数据清理失败，请再次点击重试。');
    await clearThumbnails();
  }catch(error){failure=error;}
  // The settings UI shares Chromium's default session. Restore its allowlisted
  // preferences even when a different session failed halfway through cleaning.
  await restoreSettings(retained);
  if(failure)throw failure;
  return {reset:true};
}
module.exports={UI_SETTING_KEYS,keepUiSettings,resetBrowserData};
