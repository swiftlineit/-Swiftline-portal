export {};

declare global {
  type RazorpayCheckoutResponse = {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };

  type SwiftlineRazorpayOptions = {
    key: string;
    amount: number;
    currency: string;
    name: string;
    description: string;
    order_id: string;
    handler: (response: RazorpayCheckoutResponse) => void;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    theme?: { color?: string };
    modal?: { ondismiss?: () => void };
  };

  interface Window {
    Razorpay?: new (options: SwiftlineRazorpayOptions) => { open: () => void };
  }
}
