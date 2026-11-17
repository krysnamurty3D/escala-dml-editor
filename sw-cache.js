// Service worker de cache offline da página pública da Escala DML.
// Independente do firebase-messaging-sw.js (que só cuida de push) —
// este cuida de deixar a última escala carregada disponível sem rede.
//
// Sobe a versão do CACHE_NAME quando mudar a estratégia abaixo, pra
// forçar a limpeza do cache antigo.
const CACHE_NAME = 'dml-public-v1';

// Prefixo da leitura ao vivo da escala no Firestore (ver ESCALA_PUB_URL
// no index.html do editor). A busca real sempre tem "&_="+Date.now()
// pra evitar cache do navegador — aqui ignoramos esse pedaço pra achar
// a última resposta boa guardada, já que o cache-bust muda a cada chamada.
const FS_ESCALA_PREFIX = 'https://firestore.googleapis.com/v1/projects/escala-dml/databases/(default)/documents/escalaPublica/pagina';

self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE_NAME;}).map(function(k){return caches.delete(k);}));
    }).then(function(){return self.clients.claim();})
  );
});

function semCacheBust(url){
  return url.split('&_=')[0].split('?_=')[0];
}

self.addEventListener('fetch', function(e){
  const req=e.request;
  if(req.method!=='GET')return;
  const url=req.url;

  // Dados ao vivo da escala: tenta rede, guarda a resposta boa (sem o
  // cache-bust na chave) e cai pra última guardada se a rede falhar.
  if(url.indexOf(FS_ESCALA_PREFIX)===0){
    const chave=semCacheBust(url);
    e.respondWith(
      fetch(req).then(function(res){
        if(res.ok){const copia=res.clone();caches.open(CACHE_NAME).then(function(c){c.put(chave,copia);});}
        return res;
      }).catch(function(){
        return caches.match(chave).then(function(cached){
          if(cached)return cached;
          return new Response('{}',{headers:{'Content-Type':'application/json'}});
        });
      })
    );
    return;
  }

  // Documento principal e demais arquivos do próprio site (manifest,
  // ícones): também rede primeiro, com fallback pro que já foi visto.
  if(req.mode==='navigate'||url.indexOf(self.location.origin)===0){
    e.respondWith(
      fetch(req).then(function(res){
        if(res.ok){const copia=res.clone();caches.open(CACHE_NAME).then(function(c){c.put(req,copia);});}
        return res;
      }).catch(function(){
        return caches.match(req).then(function(cached){
          return cached||caches.match('/');
        });
      })
    );
  }
});
