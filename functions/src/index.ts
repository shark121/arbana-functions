/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onCall } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
// import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

initializeApp();

const db = getFirestore();

let counter = 0;

let collectionsData:any = [];

function emptyCache() {
  collectionsData.length = 0;
}

setInterval(emptyCache, 300000);


exports.createBundle = onCall(async () => {
  counter = counter + 1;

  if (collectionsData.length > 0) {
    return { text: counter, event: collectionsData };
  }

  const event = await db.collection("events/").get();
 
  collectionsData = event.docs.map((doc) => {
    return doc.data();
  });

  return { text: counter, event: collectionsData };
});
