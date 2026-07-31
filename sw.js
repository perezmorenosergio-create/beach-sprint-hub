
const CACHE="bst-v310-navigation-recovery";
const ASSETS=[
  "./",
  "./index.html",
  "./styles.css?v=310",
  "./app.js?v=310",
  "./planning.js",
  "./config.js",
  "./import.js",
  "./timer.js"
];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).catch(()=>{})
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    Promise.all([
      caches.keys().then(names=>
        Promise.all(names.filter(name=>name!==CACHE).map(name=>caches.delete(name)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;

  const url=new URL(request.url);
  const isAppAsset=
    url.origin===self.location.origin &&
    (
      request.mode==="navigate" ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".html")
    );

  if(isAppAsset){
    event.respondWith(
      fetch(request,{cache:"no-store"})
        .then(response=>{
          const clone=response.clone();
          caches.open(CACHE).then(cache=>cache.put(request,clone)).catch(()=>{});
          return response;
        })
        .catch(()=>caches.match(request).then(r=>r||caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached=>cached||fetch(request))
  );
});
