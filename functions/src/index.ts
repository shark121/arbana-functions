/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 
 */

import { onCall} from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getCache, setRedisTriggerEvent, invokeSubscriberCallback, verifyPayment, deleteFromCache} from "./lib/utils"
import {createTicketEntry, makePaymentRequest, replenishTickets, updateTicketsQuantity, cancelTransaction} from "./lib/functions"
import {
  onDocumentCreated,
  onDocumentDeleted,
} from "firebase-functions/firestore";
import { algoliasearch } from "algoliasearch";
import { getAuth } from "firebase-admin/auth";
import * as functions from "firebase-functions/v2";
import { firestore } from "firebase-admin";



const adminStore = firestore;

const client = algoliasearch("W6M4AJCW2Z", "d8b19e7a00ef293456a27f59f480e776");


initializeApp();

const db = getFirestore();
const auth = getAuth();

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
  // if (req.auth == null ) throw new functions.https.HttpsError("unauthenticated", "Authentication required."); 

 

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





// you can infer very much from the following function that  i have not read the clean code book

exports.startPaymentProcess = onCall(async (req) => {
 console.log(req, "req")
 console.log(req.data)
  try {
    const { provider, ticketData, domain, idToken } = req.data;
    console.log( provider, ticketData, domain, idToken, "amount, provider, ticketData, domain, idToken");

    if (!provider || !ticketData || !domain) {
      throw new functions.https.HttpsError("invalid-argument", JSON.stringify({ response: null, error: "Missing required parameters." }));

    }

    await updateTicketsQuantity(ticketData.quantity, ticketData.tier, ticketData.eventID, db);

    const paymentResponse = await makePaymentRequest(provider, ticketData, domain, db);

    auth.verifyIdToken(idToken).then((decodedToken) => {
      const uid = decodedToken.uid;
      console.log(uid, "uid")
      if (uid !== ticketData.uid) {
        throw new functions.https.HttpsError("invalid-argument", JSON.stringify({ response: null, error: "Invalid Credentials." }));
      }
    }).catch((error) => {
      throw new functions.https.HttpsError("invalid-argument", JSON.stringify({ response: null, error: "Invalid Credentials." }));
    }); 

    await setRedisTriggerEvent(
      paymentResponse.response.data.reference,
      String(ticketData.scans),
      JSON.stringify(ticketData),
      60 * 60 * 1 // wait for one hour
    );

    await invokeSubscriberCallback((key) => {
      getCache(`${key}_`).then((ticketDataJSONString) => {
        cancelTransaction(ticketDataJSONString, db);
      });
    });

    if (paymentResponse.error) {
      await replenishTickets(ticketData.quantity, ticketData.tier, ticketData.eventID, db);
      throw new functions.https.HttpsError("failed-precondition", JSON.stringify({ response: null, error: paymentResponse.error }));
    }

    const createTicketResponse = await createTicketEntry(ticketData, paymentResponse.response.data.access_code, db);

    if (createTicketResponse.error) {
      await replenishTickets(ticketData.quantity, ticketData.tier, ticketData.eventID, db);
      throw new functions.https.HttpsError("internal", JSON.stringify({ response: null, error: createTicketResponse.error }));
    }

    return { response: paymentResponse, error: null };

  } catch (error) {
    console.error("Error in payment process:", error);
    throw new functions.https.HttpsError("internal", JSON.stringify({ response: null, error: String(error) || "Payment process failed." }));
  }
});



// excercise caution as the next function is absolutely horrendous

exports.updateTeamEvent = functions.https.onCall(async (req) => {
  try {
      const { authInfo, eventUploadData, targetEvent } = req.data;
      
      console.log(authInfo.token.token, eventUploadData, targetEvent.eventId, "authInfo, eventUploadData, targetEvent")

      if (!authInfo || !eventUploadData || !targetEvent) {
          throw new functions.https.HttpsError("invalid-argument", "Missing required parameters.");
      }

      const decodedToken = await auth.verifyIdToken(authInfo.token.token); 
      const uid = decodedToken.uid;

      if (uid !== authInfo.uid) {
          throw new functions.https.HttpsError("invalid-argument", "Invalid Credentials.");
      }

      console.log("Fetching team members.....");

      const teamDoc = await db.collection("teams").doc(String(targetEvent.eventId)).get(); 

      const teamMembers = teamDoc.data(); 

      console.log("teamMembers retrieved.....");

      if (!teamMembers) {
          throw new functions.https.HttpsError("not-found", "targetEvent not found");
      }

      const batch = db.batch();
      
      console.log("Updating team members.....");

      for (const member in teamMembers) { 
          // console.log(member, "member")
          if (teamMembers.hasOwnProperty(member)) { // Check for own properties
              const userRef = db.collection("users").doc(member);

              const eventToRemove = { ...targetEvent }; // 

              batch.update(userRef, {
                  events: adminStore.FieldValue.arrayRemove(eventToRemove),
              });

              batch.update(userRef, {
                  events: adminStore.FieldValue.arrayUnion(eventUploadData),
              });
          }
      }
     
      console.log("Committing batch.....");
      await batch.commit(); 

      return { message: "Team event updated successfully" }; 

  } catch (error) {
      console.error("Error in updating team event:", error);
      if (error instanceof functions.https.HttpsError) { 
          throw error;
      }
      throw new functions.https.HttpsError("internal", "Error in updating team event");
  }
});



exports.completePayment = functions.https.onCall(async (req) => {
  try {
    const batch = db.batch();
    const { reference, ticketId, userId, eventId, trxref } = req.data;
    
    console.log("Payment completion request:", req.data);

        if (!reference || !ticketId || !userId || !eventId || !trxref) {
            throw new functions.https.HttpsError("invalid-argument", "Missing required parameters.");
        }

        const receiptRef = db.collection("receipts").doc(reference); 
        const receiptDoc = await receiptRef.get();

        if (receiptDoc.exists) {
            throw new functions.https.HttpsError("failed-precondition", "Transaction already completed");
        }

        const paymentDetails = await verifyPayment(reference); 
        
        if (!paymentDetails || !paymentDetails.status || paymentDetails.status !== 'success') { 
          console.error("Payment verification failed:", paymentDetails); 
          throw new functions.https.HttpsError("failed-precondition", "Payment verification failed.");
        }
        
        batch.set(receiptRef, paymentDetails);
        
        const bookingsRef = db.collection("bookings").doc(eventId); 
        const bookingsDoc = await bookingsRef.get();
        
        if (!bookingsDoc.exists) {
            throw new functions.https.HttpsError("not-found", "Event bookings not found.");
        }

        const bookingsData = bookingsDoc.data();

        if (bookingsData && bookingsData[ticketId]) { 
          const ticketData = bookingsData[ticketId]; 
          
            ticketData.scans = ticketData?.groupNumber ? ticketData.quantity * ticketData.groupNumber : ticketData.quantity;
            ticketData.reference = reference;
            ticketData.trxref = trxref;
            ticketData.status = "completed";
            
            const userDoc = db.collection("users").doc(userId);
            
            
            bookingsData[ticketId] = ticketData;
            
            batch.update(userDoc, { tickets: firestore.FieldValue.arrayUnion(ticketData) }); 
            batch.set(bookingsRef, bookingsData, { merge: true }); 
            
            await batch.commit();
            
            try {
              await deleteFromCache(reference);
              await deleteFromCache(`${reference}_`);
              console.log("deleted from cache after successful payment");
            } catch (cacheError) {
                console.error("Error deleting from cache:", cacheError);
            }

            return { message: "Payment completed successfully." }; // Return a success message

          } else {
            console.error("Ticket not found or bookings data is missing:", bookingsData); // Log for debugging
            throw new functions.https.HttpsError("not-found", "Ticket not found.");
          }
          
        } catch (error) {
        console.error("Error completing payment:", error);

        if (error instanceof functions.https.HttpsError) {
            throw error; 
        }

        throw new functions.https.HttpsError("internal", "An error occurred during payment completion.");
    }
})

