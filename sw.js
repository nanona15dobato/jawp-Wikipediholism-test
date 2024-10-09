var CACHEID  = "m1.0.0-jawpctest1.0.0";
var CacheURL = [
    "index.html",
    "favicon.ico",
    "menu.js",
    "https://mirrors.creativecommons.org/presskit/icons/cc.svg?ref=chooser-v1",
    "https://mirrors.creativecommons.org/presskit/icons/by.svg?ref=chooser-v1",
    "https://mirrors.creativecommons.org/presskit/icons/sa.svg?ref=chooser-v1",
    "https://upload.wikimedia.org/wikipedia/commons/5/5a/Wikipedia%27s_W.svg",
    "https://upload.wikimedia.org/wikipedia/commons/2/24/Github_logo_svg.svg",
    "https://upload.wikimedia.org/wikipedia/commons/5/57/X_logo_2023_%28white%29.png",
    "https://nanona15dobato.github.io/logo.png"
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHEID) 
          .then(
          function(cache){
              return cache.addAll(CacheURL); 
          })
    );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => {
          return !CACHE_KEYS.includes(key);
        }).map(key => {
          return caches.delete(key);
        })
      );
    })
  );
});
self.addEventListener('fetch', function(event) {
  var online = navigator.onLine;
  if(online){
    event.respondWith(
      caches.match(event.request)
        .then(
        function (response) {
          if (response) {
            return response;
          }
          return fetch(event.request)
            .then(function(response){
              cloneResponse = response.clone();
              if(response){
                if(response || response.status == 200){
                  caches.open(CACHE_NAME)
                    .then(function(cache)
                    {
                      cache.put(event.request, cloneResponse)
                      .then(function(){
                      });
                    });
                }else{
                  return response;
                }
                return response;
              }
            }).catch(function(error) {
              return console.log(error);
            });
        })
    );
  }else{
    event.respondWith(
      caches.match(event.request)
        .then(function(response) {
          if (response) {
            return response;
          }
          return caches.match("offline.html")
              .then(function(responseNodata)
              {
                return responseNodata;
              });
        }
      )
    );
  }
});
