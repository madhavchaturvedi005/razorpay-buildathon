import type { PtpExtract } from "../types";
import type { PtpPolicyResult } from "./ptp-policy";

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export const REPLY_CHIPS: { id: string; label: string; utterance: string }[] = [
  {
    id: "d5",
    label: "5 din mein de dunga",
    utterance: "Salary 5 din mein aayegi, tab poora de dunga.",
  },
  {
    id: "d10",
    label: "10 din chahiye",
    utterance: "Mujhe 10 din chahiye, tab de dunga.",
  },
  {
    id: "d15",
    label: "15 din baad",
    utterance: "15 din baad de paunga, abhi nahi.",
  },
  {
    id: "hardship",
    label: "Naukri nahi hai",
    utterance: "Naukri chali gayi last week, abhi nahi de sakta. EMI pe baat kar sakte ho kya?",
  },
  {
    id: "dispute",
    label: "Galat charge hai",
    utterance: "Yeh toh fraud hai, maine yeh charge authorize nahi kiya. Complaint daal dungi RBI ombudsman mein.",
  },
];

export function openingLine(
  scenario: string,
  firstName: string,
  amountPaise: number,
  merchant: string,
): { text: string; silent_only: boolean } {
  const amt = rupees(amountPaise);
  switch (scenario) {
    case "gateway_timeout":
      return {
        silent_only: true,
        text: `Namaste ${firstName}. Bank ne time pe reply nahi diya, lekin yeh recoverable hai. Hum silent retry kar rahe hain — aapko iske liye call nahi karni chahiye thi. Main ab disconnect karti hoon.`,
      };
    case "expired_card":
      return {
        silent_only: false,
        text: `Namaste ${firstName}. Main ${merchant} ki AI recovery assistant hoon. Saved card expire ho chuka hai, isliye ${amt} cut nahi hua. Bataiye — naya card update karoge, UPI se doge, ya koi date pe promise karoge?`,
      };
    case "overdue_invoice":
      return {
        silent_only: false,
        text: `Namaste ${firstName}. Main ${merchant} ki AI recovery assistant hoon. Invoice ${amt} overdue hai. Pehle yeh batao — kya issue hai exactly? Kab tak settle kar sakte ho?`,
      };
    case "abandoned_cart":
      return {
        silent_only: false,
        text: `Namaste ${firstName}, ${merchant} se bol rahi hoon. Payment nahi maang rahi — aapne headphones wala cart chhod diya tha, woh save hai. Shipping dekh ke ruke honge. Aapke liye coupon hai: das percent off, code COMEBACK10. Chahiye toh ek dabaaiye. Nahi toh do, call khatam, koi follow-up nahi.`,
      };
    default:
      return {
        silent_only: false,
        text: `Namaste ${firstName}. Main ${merchant} ki AI recovery assistant hoon. Aapka ${amt} ka payment bank ne decline kiya — account mein balance kam tha. Bataiye, kya hua exactly? Kab tak pay kar sakte ho?`,
      };
  }
}

export function agentReply(
  extract: PtpExtract,
  policy: PtpPolicyResult,
  merchant: string,
): { text: string; done: boolean } {
  if (extract.dispute_language || extract.intent === "complaint") {
    return {
      done: true,
      text: `Samajh gayi. Dispute flag laga diya. ${merchant} ki taraf se koi automated call nahi aayegi. Human team review karegi — RBI rule ke according ab contact band.`,
    };
  }
  if (extract.intent === "hardship") {
    return {
      done: true,
      text: `Theek hai, hardship note kar liya. Force nahi karungi. EMI ya partial payment human team dekhogi. Aapko ab automated nag nahi aayega.`,
    };
  }
  if (extract.intent === "optout" || extract.intent === "refuse") {
    return {
      done: true,
      text: `Okay. DND laga diya. Automated calls band. Agar baad mein khud pay karna ho to payment link pehle wale channel pe hi rahega.`,
    };
  }
  if (extract.intent === "promise_to_pay") {
    if (policy.allowed && extract.promised_date) {
      return {
        done: true,
        text: `Done. ${merchant} ki policy ${policy.max_days} din ki hai, aapka promise uske andar hai — ${extract.promised_date}. Us din ek reminder, uske baad nahi.`,
      };
    }
    if (policy.reason === "outside_window") {
      return {
        done: false,
        text: `${merchant} ki policy hai — payment ${policy.max_days} din ke andar hona chahiye. ${policy.days_until} din allowed nahi. Kya aap ${policy.max_days} din mein de sakte ho?`,
      };
    }
    if (policy.reason === "past") {
      return {
        done: false,
        text: `Woh date nikal chuki hai. Policy max ${policy.max_days} din aage ki hai. Nayi tarikh boliye.`,
      };
    }
    return {
      done: false,
      text: `Promise sun liya, lekin date clear nahi hai. Policy max ${policy.max_days} din hai. Kaunsi tarikh bolun?`,
    };
  }
  return {
    done: false,
    text: `Thoda clearly boliye — kitne din mein pay karoge, ya koi problem hai?`,
  };
}
