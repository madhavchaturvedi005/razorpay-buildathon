// Abandoned-cart voice: shopping assistant, not collections.
// The customer left a product. We offer coupons/promos. We never demand payment.

export type CartIntent =
  | "accept_coupon"
  | "too_expensive"
  | "shipping"
  | "later"
  | "not_interested"
  | "already_bought"
  | "ask_product"
  | "unknown";

export const CART_CHIPS: { id: string; label: string; utterance: string }[] = [
  {
    id: "yes",
    label: "Haan, coupon laga do",
    utterance: "Haan, coupon laga do, order complete kar dunga.",
  },
  {
    id: "price",
    label: "Thoda mehnga lag raha",
    utterance: "Total dekh ke ruka, thoda mehnga lag raha hai.",
  },
  {
    id: "shipping",
    label: "Shipping extra lagi",
    utterance: "Shipping extra dikhi isliye cart chhod diya.",
  },
  {
    id: "later",
    label: "Baad mein dekhunga",
    utterance: "Abhi nahi, baad mein soch ke dekhunga.",
  },
  {
    id: "no",
    label: "Nahi chahiye",
    utterance: "Nahi chahiye yeh product, thanks.",
  },
];

export function extractCartIntent(utterance: string): CartIntent {
  const t = utterance.toLowerCase();

  if (/\b(1|one)\b/.test(t) && /(daba|press|coupon|haan|yes)/i.test(t)) return "accept_coupon";
  if (/\b(coupon|promo|discount|code|off)\b/.test(t) && /(haan|yes|do|laga|lagado|chahiye|ok|theek)/i.test(t)) {
    return "accept_coupon";
  }
  if (/\b(haan|yes|sure|ok|theek|laga do|lagado|complete|order kar)\b/.test(t) && !/\bnahi\b/.test(t)) {
    return "accept_coupon";
  }

  if (/\b(shipping|delivery|delivery charge|courier)\b/.test(t)) return "shipping";
  if (/\b(mehnga|mehanga|expensive|costly|price|mahenga|zyada)\b/.test(t)) return "too_expensive";
  if (/\b(baad|later|soch|sochunga|not now|kal)\b/.test(t)) return "later";
  if (/\b(nahi chahiye|nahi lena|don't want|not interested|cancel)\b/.test(t)) return "not_interested";
  if (/\b(already|kharid|bought|mil gaya)\b/.test(t)) return "already_bought";
  if (/\b(spec|battery|color|warranty|return|size)\b/.test(t)) return "ask_product";

  return "unknown";
}

export function cartAgentReply(params: {
  intent: CartIntent;
  firstName: string;
  merchant: string;
  couponCode: string;
  percent: number;
}): { text: string; done: boolean; applyCoupon: boolean } {
  const { intent, firstName, merchant, couponCode, percent } = params;
  switch (intent) {
    case "accept_coupon":
      return {
        done: false,
        applyCoupon: true,
        text: `Theek hai ${firstName}, ${percent} percent off laga deti hoon — code ${couponCode}. Cart mein apply ho jayega. Jab mann ho checkout khol lena, koi jaldi nahi.`,
      };
    case "too_expensive":
      return {
        done: false,
        applyCoupon: false,
        text: `Samajh gayi — total zyada laga. Payment ki koi zabardasti nahi. ${merchant} pe is cart ke liye ${percent} percent coupon hai, ${couponCode}. Ek dabaaiye toh laga deti hoon, do dabaaiye toh call yahin khatam.`,
      };
    case "shipping":
      return {
        done: false,
        applyCoupon: false,
        text: `Shipping extra dekh ke ruke, common hai. Extra feel na ho isliye ${percent} percent off de rahe hain, code ${couponCode}. Ek se apply, nahi toh cart save hi rahega.`,
      };
    case "later":
      return {
        done: true,
        applyCoupon: false,
        text: `Bilkul, time lo. Cart save hai. Coupon ${couponCode} aathchees ghante valid rahega. Jab ready ho tab use kar lena. Ab call nahi karungi.`,
      };
    case "not_interested":
      return {
        done: true,
        applyCoupon: false,
        text: `Koi baat nahi ${firstName}. Cart chhod dete hain, koi follow-up nahi. Bataane ke liye thanks.`,
      };
    case "already_bought":
      return {
        done: true,
        applyCoupon: false,
        text: `Oh, pehle hi le liya? Super. Phir coupon ki zaroorat nahi. Sorry for the ping — call band.`,
      };
    case "ask_product":
      return {
        done: false,
        applyCoupon: false,
        text: `Headphones chalis ghante battery, ek saal warranty, saat din return. Agar price ya shipping atka ho toh ${couponCode} se ${percent} percent off. Ek se apply, do se skip.`,
      };
    default:
      return {
        done: false,
        applyCoupon: false,
        text: `Main payment nahi maang rahi — aapka cart save hai. Sirf offer: ${percent} percent off, ${couponCode}. Chahiye toh ek, nahi toh do. Ya batao kyun chhoda tha, coupon us hisaab se dungi.`,
      };
  }
}
