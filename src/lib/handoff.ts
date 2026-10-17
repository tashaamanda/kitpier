// "Use in your app" (SPEC §9.6): the paste-ready prompt for the builder's AI coding tool. It never contains the key;
// the key goes into the builder's .env once, from the one-time snippet.

export function envSnippet(origin: string, key: string) {
  return `KITPIER_API_URL=${origin}\nKITPIER_API_KEY=${key}\n`;
}

export function handoffPrompt(businessName: string) {
  return `Add online booking for ${businessName} to my website using the Kitpier Booking API.

Setup
- My .env file already has KITPIER_API_URL and KITPIER_API_KEY.
- The key is secret. Use it only in server-side code (an API route or server action). Never send it to the browser, log it, or commit it.

How it works
My server forwards each customer message to Kitpier and shows the reply. Kitpier checks open times and, once the details are complete, returns a booking card. A booking is only made when the customer presses Confirm on that card.

Endpoints: all POST with a JSON body and the header "Authorization: Bearer <KITPIER_API_KEY>".
1. <KITPIER_API_URL>/v1/booking/converse
   body: { conversationId: string | null, requestId: string, message: string, customerIp?: string }
   returns: { conversationId, reply, booked, paused?, pending?: { id, name, email, service, date, time } | null, emailAvailable? }
   - conversationId: null for the first message, then the one you got back.
   - requestId: a new random id for each message; reuse it only to retry the same message.
   - customerIp: the visitor's IP address, so limits apply per visitor.
2. <KITPIER_API_URL>/v1/booking/confirm
   body: { conversationId, pendingId, requestId, code?: string, customerIp? }
   Call it when the customer presses Confirm. Same response shape; booked: true means the booking is made.
3. Optional, only when emailAvailable is true: <KITPIER_API_URL>/v1/booking/code
   body: { conversationId, pendingId, customerIp? }
   Emails a 6-digit code to the address on the card. Pass that code to confirm and a confirmation email is sent too.

What to build
- A booking chat on my site: messages, a text input and a Send button. Show replies as plain text, never as HTML.
- When pending is not null, show a card with service, date, time, name and email, and a Confirm button. If emailAvailable is true, add "Email me a confirmation": call code, show a 6-digit input, then pass the code to confirm.
- When booked or paused is true, disable the input, show the reply, and offer "Start a new booking" (conversationId back to null).
- On errors, show the API's "error" message. 401 means the key is wrong, 429 means too many requests.
- Keep my site's existing design.`;
}
