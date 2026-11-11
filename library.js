  
  (function(){
  var activeTab='continue';
  var DB_NAME='pustakakita-library';
  var STORE_NAME='uploads';
  function openDatabase(){
    return new Promise(function(resolve,reject){
      var request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=function(){ request.result.createObjectStore(STORE_NAME,{keyPath:'id'}); };
      request.onsuccess=function(){ resolve(request.result); };
      request.onerror=function(){ reject(request.error || new Error('Penyimpanan lokal tidak tersedia.')); };
    });
  }
  function writeFile(record,remove){
    return openDatabase().then(function(db){
      return new Promise(function(resolve,reject){
        var transaction=db.transaction(STORE_NAME,'readwrite');
        if(remove) transaction.objectStore(STORE_NAME).delete(record.id);
        else transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete=function(){ db.close(); resolve(); };
        transaction.onerror=function(){ db.close(); reject(transaction.error || new Error('Penyimpanan file gagal.')); };
        transaction.onabort=function(){ db.close(); reject(transaction.error || new Error('Penyimpanan file dibatalkan.')); };
      });
    });
  }
  PK.getUploadedFile=function(id){
    return openDatabase().then(function(db){
      return new Promise(function(resolve,reject){
        var request=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).get(id);
        request.onsuccess=function(){ var result=request.result && request.result.file; db.close(); resolve(result); };
        request.onerror=function(){ db.close(); reject(request.error || new Error('File gagal dibaca.')); };
      });
    });
  };
  function uploadIds(){ return PK.store.get('pk:uploads',[]); }
  function renderUploads(){
    var container=document.getElementById('libraryContent'), ids=uploadIds();
    if(!container) return;
    container.replaceChildren();
    if(!ids.length){
      container.innerHTML='<div class="library-empty">Belum ada file PDF atau EPUB pribadi.</div>';
      return;
    }
    function renderBookCards(container, books){
      if(!books.length){
        container.innerHTML='<div class="library-empty">Belum ada buku di bagian ini.</div>';
        return;
      }
      container.innerHTML='<div class="grid list-grid">'+books.map(PK.card).join('')+'</div>';
    }
    ids.forEach(function(id){
      var book=PK.find(id);
      if(!book) return;
      var item=document.createElement('article');
      item.className='upload-item';
      var title=document.createElement('strong');
      title.textContent=book.title;
      var type=document.createElement('span');
      type.textContent=book.fileType.toUpperCase()+' · File milik Anda';
      var open=document.createElement('a');
      open.className='detail-btn detail-btn-primary';
      open.href='#/baca/'+encodeURIComponent(book.id);
      open.textContent='Baca';
      var remove=document.createElement('button');
      remove.className='detail-btn';
      remove.type='button';
      remove.dataset.removeUpload=book.id;
      remove.textContent='Hapus';
      item.append(title,type,open,remove);
      container.append(item);
    });
  }
  function getProgress(id){ return PK.store.get('pk:read:'+encodeURIComponent(id)+':progress', null); }
  function getBookmarks(id){
    var value=PK.store.get('pk:read:'+encodeURIComponent(id)+':bookmarks', []);
    return Array.isArray(value)?value:[];
  }
  function getNotes(){
    var value=PK.store.get('pk:notes', []);
    return Array.isArray(value)?value:[];
  }
  function getCompletions(){
    var value=PK.store.get('pk:read:completions', {});
    return value && typeof value==='object' && !Array.isArray(value)?value:{};
  }
  function completionEntries(){
    var entries=getCompletions();
    var statuses=PK.statuses();
    Object.keys(statuses).forEach(function(id){
      if(isCompletedStatus(statuses[id]) && !entries[id]){
        var book=PK.find(id);
        entries[id]={completedAt:0,title:book && book.title || 'Buku terselesaikan',subjects:book && book.subjects || []};
      }
    });
    return Object.keys(entries).map(function(id){return {id:id,record:entries[id]};});
  }
  function renderDashboard(){
    var year=new Date().getFullYear();
    var completed=completionEntries();
    var completedThisYear=completed.filter(function(item){
      var date=Number(item.record.completedAt);
      return date && new Date(date).getFullYear()===year;
    }).length;
    var goalKey='pk:reading-goal:'+year;
    var goal=Number(PK.store.get(goalKey,12));
    if(!Number.isFinite(goal) || goal<1) goal=12;
    var input=document.getElementById('readingGoalInput');
    var progress=document.getElementById('readingGoalProgress');
    var ring=document.getElementById('readingGoalRing');
    var percentLabel=document.getElementById('readingGoalPercent');
    var analytics=document.getElementById('readingAnalytics');
    if(input) input.value=String(goal);
    if(progress) progress.textContent=completedThisYear+' dari '+goal+' buku selesai tahun ini';
    var goalPercent=Math.min(100,Math.round(completedThisYear/goal*100));
    if(ring){
      ring.style.setProperty('--goal-progress',goalPercent+'%');
      ring.setAttribute('aria-label','Progres target membaca '+goalPercent+'%');
    }
    if(percentLabel) percentLabel.textContent=goalPercent+'%';

    var monthly=Array(12).fill(0);
    var genres={};
    completed.forEach(function(item){
      var completedAt=Number(item.record.completedAt);
      if(completedAt && new Date(completedAt).getFullYear()===year){
        monthly[new Date(completedAt).getMonth()]++;
      }
      var book=PK.find(item.id);
      var subjects=(book && Array.isArray(book.subjects) && book.subjects) ||
        (Array.isArray(item.record.subjects)?item.record.subjects:[]);
      Array.from(new Set(subjects.filter(function(subject){return typeof subject==='string' && subject.trim();})
        .map(function(subject){return subject.trim();}))).slice(0,3).forEach(function(subject){
        var key=subject.toLocaleLowerCase();
        if(!genres[key]) genres[key]={label:subject,count:0};
        genres[key].count++;
      });
    });
    var savedTime=PK.store.get('pk:reading-time',{});
    var time=savedTime && typeof savedTime==='object' && !Array.isArray(savedTime)?savedTime:{};
    var totalSeconds=Object.keys(time).reduce(function(total,id){
      var seconds=Number(time[id]);
      return total+(Number.isFinite(seconds) && seconds>0?seconds:0);
    },0);
    var hours=(totalSeconds/3600).toFixed(1);
    var maxMonthly=Math.max(1,...monthly);
    var monthBars=monthly.map(function(count,index){
      var label=new Date(year,index,1).toLocaleString('id-ID',{month:'short'});
      return '<div class="analytics-month"><span>'+PK.esc(label)+'</span><div class="analytics-bar"><i style="width:'+Math.round(count/maxMonthly*100)+'%"></i></div><b>'+count+'</b></div>';
    }).join('');
    var topGenres=Object.values(genres).sort(function(a,b){return b.count-a.count;}).slice(0,5);
    var genreBars=topGenres.length?topGenres.map(function(genre){
      var share=Math.round(genre.count/Math.max(1,completed.length)*100);
      return '<div class="analytics-genre"><span>'+PK.esc(genre.label)+'</span><div class="analytics-bar"><i style="width:'+share+'%"></i></div><b>'+share+'%</b></div>';
    }).join(''):'<p class="library-empty">Kategori buku selesai belum tersedia.</p>';
    if(analytics) analytics.innerHTML=
      '<div class="analytics-summary"><div><strong>'+completed.length+'</strong><span>Buku selesai</span></div><div><strong>'+PK.esc(hours)+'</strong><span>Jam membaca</span></div></div>'+
      '<section class="analytics-chart"><h2>Buku selesai per bulan · '+year+'</h2><div class="analytics-months">'+monthBars+'</div></section>'+
      '<section class="analytics-chart"><h2>Kategori buku selesai</h2>'+genreBars+'</section>';
  }
  function exportLibrary(){
    var data={};
    for(var i=0;i<localStorage.length;i++){
      var key=localStorage.key(i);
      if(!key || key.indexOf('pk:')!==0 || key.indexOf('pk:catalog:')===0) continue;
      var raw=localStorage.getItem(key);
      try{data[key]=JSON.parse(raw);}catch(error){data[key]=raw;}
    }
    var payload={exportedAt:new Date().toISOString(),formatVersion:1,storage:'Data perpustakaan lokal; berkas PDF/EPUB tidak disertakan.',data:data};
    var url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    var link=document.createElement('a');
    link.href=url;
    link.download='pustakakita-perpustakaan-'+new Date().toISOString().slice(0,10)+'.json';
    link.click();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
    PK.toast('Data perpustakaan berhasil diekspor');
  }
  function renderNotes(container){
    var notes=getNotes().slice().sort(function(a,b){return Number(b.createdAt)-Number(a.createdAt);});
    container.replaceChildren();
    if(!notes.length){
      container.innerHTML='<div class="library-empty">Belum ada catatan. Saat membaca, pilih teks lalu tekan tombol Catatan.</div>';
      return;
    }
    notes.forEach(function(note){
      var item=document.createElement('article');
      item.className='library-note';
      var title=document.createElement('strong');
      title.textContent=note.bookTitle || 'Catatan buku';
      var quote=document.createElement('blockquote');
      quote.textContent=note.quote || '';
      quote.hidden=!note.quote;
      var text=document.createElement('p');
      text.textContent=note.text || '';
      var date=document.createElement('small');
      date.textContent=note.createdAt?new Date(note.createdAt).toLocaleString('id-ID'):'';
      var actions=document.createElement('div');
      actions.className='library-note-actions';
      var open=document.createElement('a');
      open.className='detail-btn detail-btn-primary';
      open.href='#/baca/'+encodeURIComponent(note.bookId)+(note.position!==undefined?'?bookmark='+encodeURIComponent(note.position):'');
      open.textContent='Buka buku';
      var copy=document.createElement('button');
      copy.className='detail-btn';
      copy.type='button';
      copy.dataset.copyNote=note.id;
      copy.textContent='Salin';
      var remove=document.createElement('button');
      remove.className='detail-btn';
      remove.type='button';
      remove.dataset.removeNote=note.id;
      remove.textContent='Hapus';
      actions.append(open,copy,remove);
      item.append(title,quote,text,date,actions);
      container.append(item);
    });
  }
  function idFromKey(key, suffix){
    var value=key.slice('pk:read:'.length, -suffix.length);
    try { return decodeURIComponent(value); } catch { return value; }
  }
  function isCompletedStatus(value){
    return value === 'complete' || value === 'completed';
  }
  function render(){
    var container = document.getElementById('libraryContent');
    if(!container) return;
    if(activeTab==='continue'){
      var items=[];
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(k && k.indexOf('pk:read:')===0 && k.endsWith(':progress')){
          var id=idFromKey(k, ':progress');
          var p=getProgress(id);
          if(p && (p.page>1 || p.percent>0)){
            var b=PK.find?PK.find(id):null;
            if(b){ b._progress=p; items.push(b); }
          }
        }
      }
      if(items.length===0){ container.innerHTML='<div class="library-empty">Belum ada buku yang sedang dibaca.</div>'; return; }
      container.innerHTML='<div class="grid list-grid">'+items.map(PK.card).join('')+'</div>';
      return;
    }
    if(activeTab==='recent'){
      var h=PK.hist?PK.hist():[];
      if(h.length===0){ container.innerHTML='<div class="library-empty">Belum ada riwayat.</div>'; return; }
      container.innerHTML='<div class="grid list-grid">'+h.map(PK.card).join('')+'</div>';
      return;
    }
    if(activeTab==='bookmarks'){
      var bmItems=[];
      for(var i2=0;i2<localStorage.length;i2++){
        var k2=localStorage.key(i2);
        if(k2 && k2.indexOf('pk:read:')===0 && k2.endsWith(':bookmarks')){
          var id2=idFromKey(k2, ':bookmarks');
          var list=getBookmarks(id2);
          if(list.length>0){
            var b2=PK.find?PK.find(id2):null;
            if(b2) list.forEach(function(mark,index){
              var item=document.createElement('article');
              item.className='library-bookmark';
              var title=document.createElement('strong');
              title.textContent=b2.title;
              var position=document.createElement('span');
              position.textContent=typeof mark.position==='number'?'Halaman '+mark.position:'Bookmark '+(index+1);
              var open=document.createElement('a');
              open.className='detail-btn detail-btn-primary';
              open.href='#/baca/'+encodeURIComponent(id2)+'?bookmark='+encodeURIComponent(mark.position);
              open.textContent='Buka bookmark';
              var remove=document.createElement('button');
              remove.className='detail-btn';
              remove.type='button';
              remove.textContent='Hapus';
              remove.addEventListener('click',function(){
                var latest=getBookmarks(id2);
                PK.store.set('pk:read:'+encodeURIComponent(id2)+':bookmarks',latest.filter(function(_,current){return current!==index;}));
                render();
              });
              item.append(title,position,open,remove);
              bmItems.push(item);
            });
          }
        }
      }
      var savedBooks=PK.savedBooks?PK.savedBooks():{};
      Object.keys(savedBooks).forEach(function(savedId){
        var savedBook=savedBooks[savedId];
        if(!savedBook) return;
        var item=document.createElement('article');
        item.className='library-bookmark';
        var title=document.createElement('strong');
        title.textContent=savedBook.title || 'Buku tersimpan';
        var position=document.createElement('span');
        position.textContent='Disimpan untuk dibaca';
        var open=document.createElement('a');
        open.className='detail-btn detail-btn-primary';
        open.href='#/buku/'+encodeURIComponent(savedId);
        open.textContent='Lihat buku';
        var remove=document.createElement('button');
        remove.className='detail-btn';
        remove.type='button';
        remove.textContent='Hapus';
        remove.addEventListener('click',function(){
          var latest=PK.savedBooks();
          delete latest[savedId];
          PK.store.set('pk:bookmarks',latest);
          render();
        });
        item.append(title,position,open,remove);
        bmItems.push(item);
      });
      container.replaceChildren();
      if(bmItems.length===0){ container.innerHTML='<div class="library-empty">Belum ada bookmark.</div>'; return; }
      bmItems.forEach(function(item){container.append(item);});
      return;
    }
    if(activeTab==='notes'){
      renderNotes(container);
      return;
    }
    if(activeTab==='favorites'){
      var f=PK.favs?PK.favs():{};
      var favsArr=Object.values(f);
      if(favsArr.length===0){ container.innerHTML='<div class="library-empty">Belum ada favorit.</div>'; return; }
      container.innerHTML='<div class="grid list-grid">'+favsArr.map(PK.card).join('')+'</div>';
      return;
    }
    if(activeTab==='want' || activeTab==='reading' || activeTab==='completed' || activeTab==='complete'){
      var statuses=PK.statuses();
      var books=Object.keys(statuses).filter(function(id){
        if(activeTab==='completed' || activeTab==='complete') return isCompletedStatus(statuses[id]);
        return statuses[id]===activeTab;
      }).map(function(id){return PK.find(id);}).filter(Boolean);
      renderBookCards(container,books);
      return;
    }
    if(activeTab==='uploads'){
      renderUploads();
      return;
    }
    container.innerHTML='<div class="library-empty">Belum ada buku selesai.</div>';
  }
  PK.views.mylibrary=function(){
    renderDashboard();
    var tabs=document.querySelectorAll('.library-tab');
    tabs.forEach(function(t){ t.onclick=function(){ tabs.forEach(function(x){x.classList.remove('active');}); t.classList.add('active'); activeTab=t.getAttribute('data-tab'); render(); }; });
    render();
  };
  document.getElementById('saveReadingGoal')?.addEventListener('click',function(){
    var input=document.getElementById('readingGoalInput');
    var value=Number(input && input.value);
    if(!Number.isInteger(value) || value<1 || value>365){
      PK.toast('Target harus berupa angka antara 1 dan 365.');
      return;
    }
    PK.store.set('pk:reading-goal:'+new Date().getFullYear(),value);
    renderDashboard();
    PK.toast('Target membaca diperbarui');
  });
  document.getElementById('exportLibrary')?.addEventListener('click',exportLibrary);
  document.addEventListener('click',async function(event){
    var remove=event.target.closest('[data-remove-note]');
    if(remove){
      var notes=getNotes().filter(function(note){return note.id!==remove.dataset.removeNote;});
      PK.store.set('pk:notes',notes);
      render();
      return;
    }
    var copy=event.target.closest('[data-copy-note]');
    if(copy){
      var note=getNotes().find(function(item){return item.id===copy.dataset.copyNote;});
      if(!note) return;
      try{
        await navigator.clipboard.writeText([note.quote,note.text].filter(Boolean).join('\n\n'));
        PK.toast('Catatan disalin');
      }catch(error){
        console.error('Catatan gagal disalin.',error);
        PK.toast('Tidak dapat menyalin catatan di browser ini.');
      }
    }
  });
  var uploadInput=document.getElementById('bookUpload');
  if(uploadInput){
    uploadInput.addEventListener('change',async function(){
      var files=Array.from(uploadInput.files || []);
      for(var file of files){
        var extension=file.name.toLowerCase().split('.').pop();
        if(!['pdf','epub'].includes(extension)){
          PK.toast('Pilih file PDF atau EPUB.');
          continue;
        }
        try{
          var id='user:'+Date.now()+':'+Math.random().toString(36).slice(2);
          var book={id:id,title:file.name.replace(/\.(pdf|epub)$/i,''),author:'File pribadi',source:'File pribadi',sources:['File pribadi'],access:'File milik Anda',accessType:'user',localFile:true,fileType:extension,cover:'',readUrl:''};
          await writeFile({id:id,name:file.name,file:file},false);
          PK.store.set('pk:b:'+id,book);
          PK.store.set('pk:uploads',Array.from(new Set(uploadIds().concat(id))));
        }catch(error){
          console.error('File buku gagal disimpan.',error);
          PK.toast('File gagal disimpan. Periksa ruang penyimpanan browser.');
        }
      }
      uploadInput.value='';
      activeTab='uploads';
      document.querySelectorAll('.library-tab').forEach(function(tab){
        tab.classList.toggle('active',tab.dataset.tab==='uploads');
      });
      render();
    });
  }
  document.addEventListener('click',async function(event){
    var button=event.target.closest('[data-remove-upload]');
    if(!button || !confirm('Hapus file buku ini dari perangkat?')) return;
    var id=button.dataset.removeUpload;
    try{
      await writeFile({id:id},true);
      PK.store.set('pk:uploads',uploadIds().filter(function(item){return item!==id;}));
      PK.store.remove('pk:b:'+id);
      renderUploads();
    }catch(error){
      console.error('File buku gagal dihapus.',error);
      PK.toast('File gagal dihapus.');
    }
  });
})();
