  
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
    var tabs=document.querySelectorAll('.library-tab');
    tabs.forEach(function(t){ t.onclick=function(){ tabs.forEach(function(x){x.classList.remove('active');}); t.classList.add('active'); activeTab=t.getAttribute('data-tab'); render(); }; });
    render();
  };
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
