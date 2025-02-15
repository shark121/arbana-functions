import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const PAYSTACK_SECRET="sk_test_df2b43fa0735c8f04d0c1e8d3157a5f9f9331fd0"

export async function makePaymentRequest(amount: number, provider: string, ticketData: any, domain :string) {
    try {
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                amount: amount * 100,
                email: "boakyes175@gmail.com",
                currency: "GHS",
                mobile_money: { provider: "mtn,vodafone" },
                callback_url: `${domain}/ticket/${ticketData.ticketID}@${ticketData.eventID}@${ticketData.uid}`,
            }),
        });

        const responseData = await response.json();
        return { response: responseData, error: null };
    } catch (error) {
        console.error("Payment request failed:", error);
        return { response: null, error: "Error processing payment." };
    }
}

// Local function to create a ticket entry in Firestore
export async function createTicketEntry(ticketData: any, transactionID: string, db: admin.firestore.Firestore) {
    const ticketEntry = { ...ticketData, transactionID, scans: 0 };

    try {
        await db.runTransaction(async (transaction) => {
            transaction.set(
                db.collection("bookings").doc(ticketEntry.eventID),
                { [ticketEntry.ticketID]: ticketEntry },
                { merge: true }
            );
        });

        return { data: 200, error: null };
    } catch (error) {
        console.error("Error in ticket entry:", error);
        return { data: 500, error: "Error creating ticket entry" };
    }
}

// Local function to replenish tickets if a transaction fails
export async function replenishTickets(quantity: number, tier: string, eventID: string, db:admin.firestore.Firestore) {
    try {
        await updateTicketsQuantity(-quantity, tier, eventID, db);
        return { success: true };
    } catch (err) {
        console.error("Error correcting database:", err);
        return { success: false, error: "Error correcting database" };
    }
}

export async function updateTicketsQuantity(requestedNumber: number, ticketTier: string, eventID: string, db:admin.firestore.Firestore) {
    const docRef = db.collection("events").doc(eventID);

    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
            throw new functions.https.HttpsError("not-found", "Event document does not exist.");
        }

        const eventData = doc.data();
        if (!eventData || !eventData.availableSeats) {
            throw new functions.https.HttpsError("failed-precondition", "Invalid ticket details.");
        }

        let updated = false;
        const availableSeats = eventData.availableSeats.map((seat: any) => {
            if (seat.tier === ticketTier) {
                if (seat.quantity >= requestedNumber) {
                    seat.quantity -= requestedNumber;
                    updated = true;
                } else {
                    throw new functions.https.HttpsError("failed-precondition", "Not enough tickets available.");
                }
            }
            return seat;
        });

        if (!updated) {
            throw new functions.https.HttpsError("failed-precondition", "Ticket tier not found.");
        }

        transaction.update(docRef, { availableSeats });
        return { success: true, price: eventData.availableSeats.find((seat: any) => seat.tier === ticketTier).price };
    });
}


export async function cancelTransaction (ticketDataJSONString:string, db:admin.firestore.Firestore){
    if (!ticketDataJSONString) {
        throw new functions.https.HttpsError("invalid-argument", "Missing required ticket data.");
    }

    try {
        const ticketData = JSON.parse(ticketDataJSONString);
        console.log("Cancelling transaction for:", ticketData);

        await updateTicketsQuantity(-ticketData.quantity, ticketData.tier, ticketData.eventID, db);

        console.log("Database corrected, transaction cancelled.");
        return { success: true, message: "Transaction successfully cancelled." };
    } catch (error) {
        console.error("Error cancelling transaction:", error);
        throw new functions.https.HttpsError("internal", String(error) || "Failed to cancel transaction.");
    }
}