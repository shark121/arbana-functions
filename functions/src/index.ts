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
import { onDocumentCreated, onDocumentDeleted} from "firebase-functions/firestore";
import { algoliasearch } from "algoliasearch";

const client = algoliasearch("W6M4AJCW2Z", "d8b19e7a00ef293456a27f59f480e776");

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

let collectionsData: any = [];

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

// async function triggerReIndexing(){
//   await db
//   .collection("events/")
//   .get()
//   .then(async (response) => {
//     console.log(
//       "data retrieved successfully,  adding to record and initiating indexing"
//     );

//     const dataObject: Record<string, unknown>[] = [];
//     response.docs.forEach((item) => {
//       dataObject.push({...item.data(), ObjectjID: item.data().eventID});
//     });

//     console.log(dataObject)

//     await client
//       .saveObjects({
//         indexName: "events_index",
//         objects: dataObject,
//       })
//       .then((res) => console.log("successful indexing "))
//       .catch((err) => console.log("there was an error indexing:", err));
//   })
//   .catch((error) => console.log(error));

// }

exports.reIndexOnDelete = onDocumentDeleted("events/{docId}", async (event) => {
  const {docId} = event.params
  console.log(docId)
    await client
      .deleteObject({
        indexName: "events_index",
        objectID : docId
        // objects: dataObject,
      })
      .then((res) => console.log("successful indexing "))
      .catch((err) => console.log("there was an error indexing:", err));
  
  //  await triggerReIndexing().then(()=>console.log("reindexed in delete succesfully")).catch(()=>console.log(("error re-indexing on delete")))
})


exports.reIndexOnCreate = onDocumentCreated("events/{doc}",async (event)=>{
  
  await db
  .collection("events/")
  .get()
  .then(async (response) => {
    console.log(
      "data retrieved successfully,  adding to record and initiating indexing"
    );

    const dataObject: Record<string, unknown>[] = [];
    response.docs.forEach((item) => {
      dataObject.push({...item.data(), objectID: item.data().eventId});
    });

    console.log(dataObject)

    await client
      .saveObjects({
        indexName: "events_index",
        objects: dataObject,
      })
      .then((res) => console.log("successful indexing "))
      .catch((err) => console.log("there was an error indexing:", err));
  })
  .catch((error) => console.log(error));
})