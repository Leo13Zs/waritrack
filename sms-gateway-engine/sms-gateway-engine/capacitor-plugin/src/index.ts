import { registerPlugin } from '@capacitor/core';

export interface ForwardingRule {
  key?: string;                     // auto-genere si absent ; meme cle = mise a jour de la regle
  sender: string;                   // "*" = tous, sinon numero/ID exact (ou regex si is_sender_regex)
  is_sender_regex?: boolean;
  sms_filter?: string;              // regex Java sur le texte ; vide = tout transferer
  url: string;                      // webhook (ex: Edge Function Supabase)
  sim_slot?: number;                // 0 = toutes, 1 ou 2
  template: string;                 // corps JSON avec %from% %text% %sentStamp% ...
  headers: string;                  // JSON *sous forme de chaine*, ex: '{"X-Foo":"bar"}'
  retries_number?: number;
  ignore_ssl?: boolean;
  chunked_mode?: boolean;
  is_sms_enabled?: boolean;
  sign_hmac_sha256?: boolean;       // ajoute l'en-tete X-Signature
  sign_hmac_sha256_secret?: string;
  store_failed?: boolean;
  local_mode?: boolean;
}

export type PermState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

export interface SmsGatewayPlugin {
  /** Ajoute/met a jour des regles (fusion par `key`). Retourne le nombre de regles importees. */
  setRules(options: { rules: string }): Promise<{ imported: number }>;
  /** Regles actuellement stockees (JSON). */
  getRules(): Promise<{ rules: string }>;
  /** Supprime toutes les regles. */
  clearRules(): Promise<void>;
  checkPermissions(): Promise<{ sms: PermState }>;
  requestPermissions(): Promise<{ sms: PermState }>;
}

export const SmsGateway = registerPlugin<SmsGatewayPlugin>('SmsGateway');

/** Helpers pratiques */
export const setRules = (rules: ForwardingRule[]) =>
  SmsGateway.setRules({ rules: JSON.stringify(rules) });
export const getRules = async (): Promise<ForwardingRule[]> =>
  JSON.parse((await SmsGateway.getRules()).rules);
