export type RazorpayWebhookPayload = {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id?: string;
        amount: number;
        currency: string;
        status?: string;
        error_code?: string;
        error_description?: string;
      };
    };
    order?: {
      entity?: {
        id: string;
        amount: number;
        currency: string;
        status?: string;
      };
    };
    refund?: {
      entity?: {
        id: string;
        payment_id?: string;
        amount: number;
        currency: string;
        status?: string;
      };
    };
  };
};

export function parseRazorpayWebhookPayload(rawBody: Buffer) {
  return JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookPayload;
}
