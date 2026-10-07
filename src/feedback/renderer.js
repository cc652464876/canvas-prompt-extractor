'use strict';
const $=id=>document.getElementById(id);
const icons={opening:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',jumping:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v5a3 3 0 0 0 3 3H14"/>',reading:'<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 8h10M7 12h10M7 16h6"/>',done:'<path d="m5 12 4 4L19 6"/>',attention:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>',cancelled:'<rect x="5" y="5" width="14" height="14" rx="2"/>'};
window.renderFeedback=payload=>{
  window.CanvasThemes.applyTheme(document.documentElement,payload.theme,payload.theme?.resolvedMode==='dark');
  const panel=document.querySelector('.panel');panel.dataset.phase=payload.phase;
  const terminal=!payload.active,done=payload.phase==='done';
  const stage=payload.heading==='正在提取画布'?2:payload.heading==='画布跳转中'?1:0;
  const icon=terminal?(done?'done':payload.phase==='cancelled'?'cancelled':'attention'):payload.phase==='attention'?'attention':['opening','jumping','reading'][stage];
  $('status-icon').innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[icon]+'</svg>';
  $('heading').textContent=payload.heading;
  $('description').textContent=done?'画布内容已读取，可返回主程序继续操作':payload.message;
  $('steps').hidden=terminal;$('counts').hidden=!(done&&payload.counts);
  document.querySelectorAll('.step').forEach((item,index)=>{item.className='step'+(index<stage?' done':index===stage?' current':'');});
  if(payload.counts){$('node-count').textContent=payload.counts.nodes;$('prompt-count').textContent=payload.counts.prompts;$('asset-count').textContent=payload.counts.assets;}
  const attention=payload.phase==='attention'&&/广告|弹窗|弹层|登录/.test(payload.message);
  $('note-icon').innerHTML=done?'<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2ZM12 10v6m-3-3 3 3 3-3"/>':terminal||attention?'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>':'<path d="m11 5-6 4H2v6h3l6 4V5Zm6 4 5 6m0-6-5 6"/>';
  $('note-title').textContent=done?'可以保存提示词或下载素材':terminal?'本次读取已结束':attention?'关闭说明后处理页面弹窗':'提取期间已临时静音';
  $('note-first').textContent=done?'提取期间的临时静音已结束。':terminal?'请检查页面、网络或登录状态后重新读取。':attention?'请关闭普通广告，或完成平台登录。':'请尽量不要切换作品或关闭画布。';
  $('note-second').textContent=done?'请在主程序中选择需要保存或下载的内容。':terminal?'需要继续时，在主程序点击“开始读取画布”。':attention?'若仍未成功，请返回主程序重新读取。':'如遇广告或登录弹窗，关闭本说明后处理。';
  if(payload.phase==='cancelled'){$('note-first').textContent='停止读取后已恢复原音量设置。';$('note-second').textContent='需要继续时，可在主程序重新读取当前作品。';}
  $('foot').textContent=terminal?'关闭说明不会关闭平台窗口':'关闭说明后，提取仍会继续';
  return {height:Math.ceil(panel.getBoundingClientRect().height)};
};
$('close').addEventListener('click',()=>window.feedback.close());
