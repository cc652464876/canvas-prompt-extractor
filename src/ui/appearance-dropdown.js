// One-level selector shared by palettes and prompt fonts.
export function createAppearanceDropdown({trigger,list,options,onChange}) {
  let selected=options[0]?.value,search='',searchTimer;
  const buttons=[];
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',list.id);list.setAttribute('role','listbox');
  function close(focus=false){list.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
  function open(index=options.findIndex(option=>option.value===selected)){
    document.dispatchEvent(new CustomEvent('appearance-dropdown-open',{detail:trigger.id}));list.hidden=false;trigger.setAttribute('aria-expanded','true');
    list.classList.remove('opens-up');list.style.maxHeight='220px';
    const rect=trigger.getBoundingClientRect(),bounds=trigger.closest('dialog').getBoundingClientRect();
    const below=Math.min(innerHeight-16,bounds.bottom-8)-rect.bottom-6,above=rect.top-Math.max(16,bounds.top+8)-6;
    const upward=below<list.scrollHeight&&above>below;list.classList.toggle('opens-up',upward);
    list.style.maxHeight=Math.max(40,Math.min(220,upward?above:below))+'px';
    const button=buttons[Math.max(0,index)];button?.focus();button?.scrollIntoView({block:'nearest'});
  }
  function choose(index){selected=options[index].value;onChange(selected);close(true);}
  options.forEach((option,index)=>{
    const button=document.createElement('button');button.type='button';button.className='appearance-option';button.tabIndex=-1;button.dataset.value=option.value;button.setAttribute('role','option');
    if(option.badge){const badge=document.createElement('span');badge.className='dropdown-badge';badge.textContent=option.badge;badge.setAttribute('aria-hidden','true');button.append(badge);}
    const text=document.createElement('span');text.className='option-label';text.textContent=option.label;
    const check=document.createElement('span');check.className='option-check';check.textContent='✓';check.setAttribute('aria-hidden','true');button.append(text,check);
    button.addEventListener('click',()=>choose(index));list.append(button);buttons.push(button);
  });
  function set(value){
    selected=options.some(option=>option.value===value)?value:options[0]?.value;const option=options.find(option=>option.value===selected);
    trigger.querySelector('.dropdown-label').textContent=option?.label||'';const badge=trigger.querySelector('.dropdown-badge');if(badge)badge.textContent=option?.badge||'';
    for(let i=0;i<buttons.length;i++)buttons[i].setAttribute('aria-selected',String(options[i].value===selected));
  }
  trigger.addEventListener('click',()=>list.hidden?open():close(true));
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp'?options.length-1:undefined);}});
  list.addEventListener('keydown',event=>{
    const current=Math.max(0,buttons.indexOf(document.activeElement));let index;
    if(event.key==='ArrowDown')index=(current+1)%buttons.length;if(event.key==='ArrowUp')index=(current-1+buttons.length)%buttons.length;
    if(event.key==='Home')index=0;if(event.key==='End')index=buttons.length-1;
    if(index!==undefined){event.preventDefault();buttons[index].focus();buttons[index].scrollIntoView({block:'nearest'});}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(current);}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
    else if(event.key==='Tab'){close(true);}
    else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey){clearTimeout(searchTimer);search+=event.key.toLowerCase();searchTimer=setTimeout(()=>{search='';},700);const match=options.findIndex(option=>option.label.toLowerCase().startsWith(search));if(match>=0)buttons[match].focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!trigger.parentElement.contains(event.target))close();});
  document.addEventListener('appearance-dropdown-open',event=>{if(event.detail!==trigger.id)close();});
  document.addEventListener('appearance-reset',()=>close());
  document.addEventListener('appearance-dropdown-close',()=>close());
  const dialog=trigger.closest('dialog');dialog.addEventListener('close',()=>{if(!dialog.open)close();});dialog.addEventListener('cancel',event=>{if(!list.hidden){event.preventDefault();close(true);}});
  function setBadgeColors(colors){
    for(let i=0;i<buttons.length;i++){const badge=buttons[i].querySelector('.dropdown-badge');if(badge)badge.style.color=colors[options[i].value]||'';}
    const badge=trigger.querySelector('.dropdown-badge');if(badge)badge.style.color=colors[selected]||'';
  }
  set(selected);return {set,close,open,setBadgeColors};
}
