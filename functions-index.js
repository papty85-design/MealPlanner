const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * Funzione che invia notifiche quando il menu viene aggiornato
 */
exports.sendMenuNotification = functions.database
  .ref('/families/{familyCode}/menu')
  .onUpdate(async (change, context) => {
    const familyCode = context.params.familyCode;
    const after = change.after.val();
    const before = change.before.val();
    
    // Trova quale giorno è stato modificato
    let modifiedDay = null;
    let modifiedMeal = null;
    
    for (const day in after) {
      if (JSON.stringify(after[day]) !== JSON.stringify(before[day])) {
        modifiedDay = day;
        if (after[day].lunch !== before[day].lunch) {
          modifiedMeal = `Pranzo: ${after[day].lunch}`;
        } else if (after[day].dinner !== before[day].dinner) {
          modifiedMeal = `Cena: ${after[day].dinner}`;
        }
        break;
      }
    }
    
    // Recupera i membri della famiglia
    const membersSnapshot = await admin.database()
      .ref(`/families/${familyCode}/members`)
      .once('value');
    
    const members = membersSnapshot.val();
    const tokens = [];
    
    // Raccoglie i token FCM di tutti i membri con notifiche attive
    for (const memberId in members) {
      const member = members[memberId];
      if (member.notificationsEnabled && member.fcmToken) {
        tokens.push(member.fcmToken);
      }
    }
    
    // Invia notifica
    if (tokens.length > 0) {
      const message = {
        notification: {
          title: '🍝 Menu Aggiornato',
          body: modifiedDay && modifiedMeal 
            ? `${modifiedDay} - ${modifiedMeal}` 
            : 'Un membro della famiglia ha modificato il menu settimanale',
          icon: '/icon-192.png'
        },
        data: {
          type: 'menu_update',
          familyCode: familyCode,
          day: modifiedDay || '',
          timestamp: Date.now().toString()
        },
        tokens: tokens
      };
      
      try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`Notifica menu inviata con successo: ${response.successCount}/${tokens.length}`);
        
        // Log degli errori
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              console.error(`Errore invio a token ${idx}:`, resp.error);
              
              // Rimuovi token non validi
              if (resp.error.code === 'messaging/invalid-registration-token' ||
                  resp.error.code === 'messaging/registration-token-not-registered') {
                // Trova e rimuovi il token non valido
                const invalidToken = tokens[idx];
                for (const memberId in members) {
                  if (members[memberId].fcmToken === invalidToken) {
                    admin.database()
                      .ref(`/families/${familyCode}/members/${memberId}/fcmToken`)
                      .remove();
                    break;
                  }
                }
              }
            }
          });
        }
      } catch (error) {
        console.error('Errore invio notifica menu:', error);
      }
    }
  });

/**
 * Funzione che invia notifiche quando la lista della spesa viene aggiornata
 */
exports.sendShoppingListNotification = functions.database
  .ref('/families/{familyCode}/shoppingList')
  .onUpdate(async (change, context) => {
    const familyCode = context.params.familyCode;
    const after = change.after.val();
    const before = change.before.val();
    
    // Determina cosa è cambiato
    let changeDescription = 'La lista della spesa è stata modificata';
    const afterItems = after || [];
    const beforeItems = before || [];
    
    if (afterItems.length > beforeItems.length) {
      const newItem = afterItems.find(item => 
        !beforeItems.find(b => b.id === item.id)
      );
      if (newItem) {
        changeDescription = `Aggiunto: ${newItem.name}`;
      }
    } else if (afterItems.length < beforeItems.length) {
      const removedItem = beforeItems.find(item => 
        !afterItems.find(a => a.id === item.id)
      );
      if (removedItem) {
        changeDescription = `Rimosso: ${removedItem.name}`;
      }
    }
    
    // Recupera i membri della famiglia
    const membersSnapshot = await admin.database()
      .ref(`/families/${familyCode}/members`)
      .once('value');
    
    const members = membersSnapshot.val();
    const tokens = [];
    
    for (const memberId in members) {
      const member = members[memberId];
      if (member.notificationsEnabled && member.fcmToken) {
        tokens.push(member.fcmToken);
      }
    }
    
    if (tokens.length > 0) {
      const message = {
        notification: {
          title: '🛒 Lista Spesa Aggiornata',
          body: changeDescription,
          icon: '/icon-192.png'
        },
        data: {
          type: 'shopping_list_update',
          familyCode: familyCode,
          timestamp: Date.now().toString()
        },
        tokens: tokens
      };
      
      try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`Notifica lista spesa inviata: ${response.successCount}/${tokens.length}`);
        
        // Gestione errori
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              console.error(`Errore invio a token ${idx}:`, resp.error);
              
              if (resp.error.code === 'messaging/invalid-registration-token' ||
                  resp.error.code === 'messaging/registration-token-not-registered') {
                const invalidToken = tokens[idx];
                for (const memberId in members) {
                  if (members[memberId].fcmToken === invalidToken) {
                    admin.database()
                      .ref(`/families/${familyCode}/members/${memberId}/fcmToken`)
                      .remove();
                    break;
                  }
                }
              }
            }
          });
        }
      } catch (error) {
        console.error('Errore invio notifica lista spesa:', error);
      }
    }
  });

/**
 * Funzione per pulizia automatica dei membri inattivi
 * Si attiva ogni giorno a mezzanotte
 */
exports.cleanupInactiveMembers = functions.pubsub
  .schedule('0 0 * * *')
  .timeZone('Europe/Rome')
  .onRun(async (context) => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    // Recupera tutte le famiglie
    const familiesSnapshot = await admin.database()
      .ref('/families')
      .once('value');
    
    const families = familiesSnapshot.val();
    let removedCount = 0;
    
    for (const familyCode in families) {
      const family = families[familyCode];
      
      if (family.members) {
        for (const memberId in family.members) {
          const member = family.members[memberId];
          
          // Rimuovi membri inattivi da più di 30 giorni
          if (member.lastActive && member.lastActive < thirtyDaysAgo) {
            await admin.database()
              .ref(`/families/${familyCode}/members/${memberId}`)
              .remove();
            removedCount++;
            console.log(`Rimosso membro inattivo: ${memberId} dalla famiglia ${familyCode}`);
          }
        }
      }
    }
    
    console.log(`Pulizia completata: rimossi ${removedCount} membri inattivi`);
  });

/**
 * Funzione per inviare promemoria giornalieri
 * Si attiva alle 11:00 per il pranzo e alle 17:00 per la cena
 */
exports.sendDailyMealReminder = functions.pubsub
  .schedule('0 11,17 * * *')
  .timeZone('Europe/Rome')
  .onRun(async (context) => {
    const now = new Date();
    const hour = now.getHours();
    const mealType = hour === 11 ? 'pranzo' : 'cena';
    const mealEmoji = hour === 11 ? '🍝' : '🍕';
    
    // Ottieni il giorno della settimana in italiano
    const daysOfWeek = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const today = daysOfWeek[now.getDay()];
    
    // Recupera tutte le famiglie
    const familiesSnapshot = await admin.database()
      .ref('/families')
      .once('value');
    
    const families = familiesSnapshot.val();
    
    for (const familyCode in families) {
      const family = families[familyCode];
      
      // Controlla se c'è un pasto programmato per oggi
      if (family.menu && family.menu[today]) {
        const todayMeal = family.menu[today];
        const meal = mealType === 'pranzo' ? todayMeal.lunch : todayMeal.dinner;
        
        if (meal) {
          // Raccogli i token dei membri con notifiche attive
          const tokens = [];
          
          if (family.members) {
            for (const memberId in family.members) {
              const member = family.members[memberId];
              if (member.notificationsEnabled && member.fcmToken) {
                tokens.push(member.fcmToken);
              }
            }
          }
          
          if (tokens.length > 0) {
            const message = {
              notification: {
                title: `${mealEmoji} Promemoria ${mealType.charAt(0).toUpperCase() + mealType.slice(1)}`,
                body: `Oggi a ${mealType}: ${meal}`,
                icon: '/icon-192.png'
              },
              data: {
                type: 'meal_reminder',
                familyCode: familyCode,
                mealType: mealType,
                meal: meal,
                timestamp: Date.now().toString()
              },
              tokens: tokens
            };
            
            try {
              const response = await admin.messaging().sendMulticast(message);
              console.log(`Promemoria ${mealType} inviato alla famiglia ${familyCode}: ${response.successCount}/${tokens.length}`);
            } catch (error) {
              console.error(`Errore invio promemoria famiglia ${familyCode}:`, error);
            }
          }
        }
      }
    }
  });

/**
 * Funzione HTTP per inviare notifiche personalizzate
 * Può essere chiamata dall'app per notifiche specifiche
 */
exports.sendCustomNotification = functions.https.onCall(async (data, context) => {
  // Verifica autenticazione (opzionale)
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'La richiesta deve essere autenticata.'
    );
  }
  
  const { familyCode, title, body, type } = data;
  
  if (!familyCode || !title || !body) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Parametri mancanti: familyCode, title, body sono obbligatori.'
    );
  }
  
  // Recupera i membri della famiglia
  const membersSnapshot = await admin.database()
    .ref(`/families/${familyCode}/members`)
    .once('value');
  
  const members = membersSnapshot.val();
  const tokens = [];
  
  for (const memberId in members) {
    const member = members[memberId];
    if (member.notificationsEnabled && member.fcmToken) {
      tokens.push(member.fcmToken);
    }
  }
  
  if (tokens.length === 0) {
    return { success: true, message: 'Nessun membro con notifiche attive' };
  }
  
  const message = {
    notification: {
      title: title,
      body: body,
      icon: '/icon-192.png'
    },
    data: {
      type: type || 'custom',
      familyCode: familyCode,
      timestamp: Date.now().toString()
    },
    tokens: tokens
  };
  
  try {
    const response = await admin.messaging().sendMulticast(message);
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      message: `Notifica inviata a ${response.successCount} membri`
    };
  } catch (error) {
    throw new functions.https.HttpsError(
      'internal',
      'Errore durante l\'invio della notifica',
      error
    );
  }
});
