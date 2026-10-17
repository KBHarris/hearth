// Fixed copy only: never display or parse untrusted push content.
self.addEventListener('push',event=>{event.waitUntil(self.registration.showNotification('Hearth',{body:'New activity in Hearth.',tag:'hearth-activity'}))})
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const tab of tabs){if(new URL(tab.url).origin===self.location.origin){await tab.focus();return}}await self.clients.openWindow(self.location.origin+'/')})())})
