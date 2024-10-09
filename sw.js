self.addEventListener('fetch', function (e) {
  console.log('sw fetch')
})

self.addEventListener('install', function (e) {
  console.log('sw install')
})

self.addEventListener('activate', function (e) {
  console.log('sw activate')
})
