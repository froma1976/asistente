self.addEventListener('push', event => {
  const id = event.data?.json()?.id;
  if (!/^call_\d+$/.test(id)) return;
  event.waitUntil(self.registration.showNotification('Fernando está atendiendo la llamada', {
    body:'Toca para ver la transcripción en directo.', tag:id, data:{id}, icon:'/clara.svg'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.id;
  if (!/^call_\d+$/.test(id)) return;
  event.waitUntil(clients.openWindow('/transcripciones.html?llamada='+encodeURIComponent(id)));
});
