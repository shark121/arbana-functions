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
import {
  onDocumentCreated,
  onDocumentDeleted,
} from "firebase-functions/firestore";
import { algoliasearch } from "algoliasearch";
import { getAuth } from "firebase-admin/auth";
import { firestore } from "firebase-admin";

const adminStore = firestore;

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
const auth = getAuth();

// const  {bucket} =  storage

let counter = 0;

let eventCollectionData: any = [];

function emptyCache() {
  eventCollectionData.length = 0;
}

setInterval(emptyCache, 300000);

exports.createBundle = onCall(async (data) => {
  counter = counter + 1;

  if (eventCollectionData.length > 0) {
    return { text: counter, event: eventCollectionData };
  }

  const event = await db.collection("events/").get();

  eventCollectionData = event.docs.map((doc) => {
    return doc.data();
  });

  return { text: counter, event: eventCollectionData };
});

exports.reIndexOnDelete = onDocumentDeleted("events/{docId}", async (event) => {
  const { docId } = event.params;
  const docIdSliced = String(docId).slice(0, 6);

  console.log(docId);
  await client
    .deleteObject({
      indexName: "events_index",
      objectID: docIdSliced,
      // objects: dataObject,
    })
    .then((res) => console.log("successful indexing "))
    .catch((err) => console.log("there was an error indexing:", err));

  //  await triggerReIndexing().then(()=>console.log("reindexed in delete succesfully")).catch(()=>console.log(("error re-indexing on delete")))
});

exports.reIndexOnCreate = onDocumentCreated("events/{docId}", async (event) => {
  const { docId } = event.params;
  const docIdSliced = String(docId).slice(0, 6);
  let docData = event.data?.data();

  // console.log(docId, docIdSliced, event.data?.data())

  if (docData) {
    docData["eventId"] = docIdSliced;
    docData["objectID"] = docIdSliced;

    console.log(docId, docData);
    await client
      .saveObject({
        indexName: "events_index",
        body: docData,
      })
      .then((res) => console.log("successful indexing "))
      .catch((err) => console.log("there was an error indexing:", err));
  }

  // await db
  // .collection("events/")
  // .get()
  // .then(async (response) => {
  //   console.log(
  //     "data retrieved successfully,  adding to record and initiating indexing"
  //   );

  //   const dataObject: Record<string, unknown>[] = [];
  //   response.docs.forEach((item) => {
  //     const {eventId,...itemData} = item.data()
  //     itemData["eventId"] = String(eventId).slice(0,6)
  //     itemData["imageUrl"] = itemData.imageUrl.slice(0,1000)

  //     console.log(itemData)

  //     dataObject.push({...itemData, objectID: Number(String(item.data().eventId).slice(0,6))});
  //   });

  //   console.log(dataObject)

  //   await client
  //     .saveObjects({
  //       indexName: "events_index",
  //       objects: dataObject,
  //     })
  //     .then((res) => console.log("successful indexing "))
  //     .catch((err) => console.log("there was an error indexing:", err));
  // })
  // .catch((error) => console.log(error));
});

type addTeamMemberRequestType = {
  email: string;
  eventId: string;
  permissions: {
    canEdit: boolean;
    canScan: boolean;
    canViewStats: boolean;
  };
};

exports.addTeamMember = onCall(async (data) => {
  const body = data.data as addTeamMemberRequestType;

  await auth.getUserByEmail(body.email).then(async (userRecord) => {
    const userId = userRecord.uid;
    const displayName = userRecord.displayName;

    await db
      .collection("teams")
      .doc(body.eventId)
      .set(
        {
          [userId]: {
            info: {
              email: body.email,
              uid: userId,
              name: displayName ?? "",
            },
            permissions: body.permissions,
          },
        },
        { merge: true }
      );

    console.log("Successfully fetched user data:", userRecord.toJSON());

    const eventInfo = (
      await db.collection("events").doc(body.eventId).get()
    ).data();

    eventInfo && (eventInfo["permissions"] = body.permissions);

    await db
      .collection("users")
      .doc(userId)
      .update({
        events: adminStore.FieldValue.arrayUnion(eventInfo),
      });
  });

  // const {teamId, teamMember} = data
  // const teamRef = db.collection("teams").doc(teamId)
  // const team = await teamRef.get()
  // const teamData = team.data()
  // const teamMembers = teamData?.teamMembers || []
  // teamMembers.push(teamMember)
  // await teamRef.update({teamMembers})
  // return {teamMembers}
});

exports.removeTeamMember = onCall(async (data) => {});

function addOrUpdate(
  map: Map<string, number>,
  key: string,
  increment: number = 1
): void {
  map.set(key, (map.get(key) || 0) + increment);
}


type getStatisticsReturnType = {
  err: string | null;
  data: Record<string, number> | null;
};

exports.getStatistics = onCall(async (req):Promise<getStatisticsReturnType> => {
  const { eventId, userId } = req.data;

  if (!(eventId && userId))
    return { err: "Missing eventId or userId", data: null };

  const permissions = await db.collection("teams").doc(eventId).get();

  const bookingsMap = new Map<string, number>();

  if (permissions.exists) {
    const permissionsData = permissions.data();

    const userPermissions = permissionsData?.[userId]?.permissions;

    if (userPermissions && userPermissions.canViewStats) {
      const bookings = (
        await db.collection("bookings").doc(eventId).get()
      ).data();

      for (let booking in bookings) {
        // let currentBookings = bookingsMap.get(bookings[booking]) || new Map<string, number>()
        // addOrUpdate(currentBookings, "quantity" , bookings[booking].scans)
        // bookingsMap.set(booking, currentBookings)
        addOrUpdate(
          bookingsMap,
          bookings[booking].tier,
          bookings[booking].quantity
        );
      }

      console.log(bookingsMap);
      const bookingsMapToObject = Object.fromEntries(bookingsMap);

      return { err: null, data: bookingsMapToObject };
    }
  }

  return {
    err: "User does not have permissions to view stats, ",
    data: null,
  };
});


type scanResultsType = {
  scans: number | null;
  quantity: number | null;
  ticketData : Record<string, unknown> | null;
  err?: string | null
};

exports.scanTicket = onCall(async (req): Promise<scanResultsType> =>{
  const { eventId, userId, ticketID } = req.data;

  if (!(eventId && userId && ticketID))
    return { err: "Invalid request", scans: null, quantity: null, ticketData: null };

  const permissions = await db.collection("teams").doc(eventId).get();

  if (permissions.exists) {
    const permissionsData = permissions.data();

    const userPermissions = permissionsData?.[userId]?.permissions;

    if (userPermissions && userPermissions.canScan) {
      const ticketBookings = (
        await db.collection("bookings").doc(eventId).get()
      );

      if (!ticketBookings.exists) {
        console.log("Document does not exist in the database");
        return { scans: null, err: "Document does not exist in the database", quantity: null, ticketData: null};
      }

      const bookingsData = ticketBookings.data();

      if (bookingsData) {
        console.log(Object.keys(bookingsData));
      } else {
        console.log("Bookings data is undefined");
      }

      if (bookingsData && Object.keys(bookingsData).includes(ticketID)) {
        console.log(bookingsData, "bookings data");
        const ticketData = bookingsData[ticketID];
        console.log(ticketData, "ticket Data.......................");

        const scans = ticketData.scans;

        if(scans > 0) ticketData["scans"] = scans - 1;

        await db.collection("bookings").doc(eventId).set(
          {
            [ticketID]: ticketData,
          },
          { merge: true }
        );

        return { scans, quantity : ticketData.quantity, err: null, ticketData: ticketData};
      }
    }
  }

  return {
    err: "User does not have permissions to scan, ",
    scans: null,
    quantity: null,
    ticketData: null
  };
});


exports.updateEvent = onCall(async (req) => {
  const { eventId, userId, data } = req.data;

  if (!(eventId && userId && data))
    return { err: new Error("Invalid request"), data: null };

  const permissions = await db.collection("teams").doc(eventId).get();

  if (permissions.exists) {
    const permissionsData = permissions.data();

    const userPermissions = permissionsData?.[userId]?.permissions;

    if (userPermissions && userPermissions.canEdit) {
      await db.collection("events").doc(eventId).set(data, { merge: true });
      
      return { err: null, data: data };
    }
  }

  return {
    err: new Error("User does not have permissions to edit, "),
    data: null,
  };
});