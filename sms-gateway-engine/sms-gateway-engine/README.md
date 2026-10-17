# sms-gateway-engine

Le **moteur** extrait de [`bogkonstantin/android_income_sms_gateway_webhook`](https://github.com/bogkonstantin/android_income_sms_gateway_webhook) (licence MIT) :
recevoir un SMS Android → le filtrer → le transformer en JSON → l'envoyer en `POST` vers une URL (webhook), avec signature HMAC et retries.
Aucune interface : uniquement la logique, prête à être branchée dans ton propre projet.

> Android uniquement : la lecture des SMS entrants n'existe pas en PWA/web, ni sur iOS.

---

## 1. Contenu

```
engine/tech/bogomolov/incomingsmsgateway/
├── SmsBroadcastReceiver.java      ← LE POINT D'ENTREE : reçoit le SMS, applique les règles, déclenche l'envoi
├── ForwardingConfig.java          ← modèle d'une règle + stockage (SharedPreferences "phones") + template
├── Request.java                   ← le POST HTTP(S) : en-têtes, signature HMAC-SHA256, TLS
├── RequestWorker.java             ← job WorkManager : attend le réseau, exécute Request, retries/backoff
├── SSLSocketFactory/
│   └── TLSSocketFactory.java      ← fabrique de sockets TLS (utilisée par Request)
├── DeviceInfo.java                ← (support) %battery% %power% %network% %version% pour ForwardingConfig
└── FailedMessage.java             ← (support) mémorise les envois définitivement échoués (RequestWorker)

capacitor-plugin/                  ← squelette de plugin Capacitor (colle JS <-> moteur), SANS le moteur
supabase/                          ← table + Edge Function qui reçoit le webhook et vérifie la signature
LICENSE.txt                        ← MIT d'origine : à conserver dans ce que tu distribues
```

Les 5 premiers fichiers sont le moteur. `DeviceInfo` et `FailedMessage` sont référencés par eux : sans eux, ça ne compile pas.

### Modifications faites par rapport à l'original (marquées `// PATCH`)
Pour que le moteur soit autonome (hors de l'app d'origine, donc sans son `R` ni son `BuildConfig`) :

| Fichier | Avant | Après |
|---|---|---|
| `SmsBroadcastReceiver` | `context.getString(R.string.asterisk)` | `"*"` |
| `ForwardingConfig` | `context.getString(R.string.key_phones_preference)` | `"phones"` |
| `DeviceInfo` | `BuildConfig.VERSION_NAME` | `"engine-1.0"` |
| `Request` | `AllowAllHostnameVerifier` (Apache, déprécié) | `(hostname, session) -> true` |

Le reste est le code d'origine, intact. Le package reste `tech.bogomolov.incomingsmsgateway` (tu peux le renommer partout si tu veux).

> Ce paquet n'a **pas été compilé** : je n'avais pas de SDK Android pour le faire. Le premier build peut révéler un détail de version (voir §6).

---

## 2. Comment ça fonctionne exactement

```
SMS reçu
  └─> Android lance SmsBroadcastReceiver (déclaré dans le manifeste → marche app fermée)
        ├─ lit toutes les règles (ForwardingConfig.getAll)
        └─ pour CHAQUE règle :
             1. règle désactivée (is_sms_enabled=false)  → ignorée
             2. sender : "*" = tous | égalité exacte | regex si is_sender_regex
                         (regex invalide → ne matche rien : "fail closed")
             3. sms_filter : regex Java sur le texte ; vide = tout passe
                         (regex invalide → passe : "fail open")
             4. sim_slot : 0 = toutes, 1 ou 2
             5. prepareMessage() remplit le template (%from%, %text%...)
             6. RequestWorker.enqueue() → WorkManager
                    └─ attend un réseau validé (sauf local_mode)
                    └─ Request : POST JSON (+ en-têtes, + X-Signature si HMAC)
                    └─ 2xx = succès | autre code ou erreur réseau = retry (backoff exponentiel)
                    └─ au-delà de retries_number : échec définitif
                         (sauvegardé par FailedMessage si store_failed=true)
```

Points précis, lus dans le code :
- Une règle = une destination. Un même SMS peut partir vers **plusieurs** URL si plusieurs règles matchent.
- Tout code HTTP non-2xx (même 401/404) est retenté jusqu'à `retries_number`.
- La signature est `X-Signature` = HMAC-SHA256 **hexadécimal minuscule** du corps brut envoyé, avec ton secret.
- Les règles sont stockées dans les `SharedPreferences` nommées `phones`, une entrée par règle (JSON).

### Format d'une règle (champs = clés JSON)

| Clé | Type | Rôle |
|---|---|---|
| `key` | string | identifiant ; absent → généré. Même `key` à l'import = mise à jour de la règle |
| `sender` | string | `"*"`, un numéro/ID exact, ou une regex |
| `is_sender_regex` | bool | interprète `sender` comme une regex (`find()`) |
| `sms_filter` | string | regex sur le corps ; `""` = tout |
| `url` | string | webhook |
| `sim_slot` | int | 0 toutes, 1, 2 |
| `template` | string | corps JSON avec placeholders |
| `headers` | **string** | un JSON **encodé en chaîne**, ex. `"{\"X-App\":\"demo\"}"` |
| `retries_number` | int | nombre max de tentatives |
| `ignore_ssl` | bool | accepte tout certificat (à éviter) |
| `chunked_mode` | bool | `Transfer-Encoding: chunked` (sinon Content-Length fixe) |
| `is_sms_enabled` | bool | active/désactive la règle |
| `sign_hmac_sha256` / `sign_hmac_sha256_secret` | bool / string | signature `X-Signature` |
| `store_failed` | bool | garde les envois définitivement échoués |
| `local_mode` | bool | n'exige pas Internet validé (webhook sur le LAN) |

Champs requis à l'import : `sender`, `url`, `template`, `headers`, sinon la règle est ignorée. Donne tous les champs pour éviter les surprises.

### Placeholders du template
`%from%` `%text%` `%sim%` `%sentStamp%` `%receivedStamp%` (les deux acceptent un format : `%sentStamp=yyyy-MM-dd HH:mm:ss%`),
`%version%` `%battery%` `%power%` `%network%`, et `%Regex=...%` (extrait un groupe d'une regex appliquée au SMS).
Template par défaut : `ForwardingConfig.getDefaultJsonTemplate()`.
Attention : `%text%` est échappé pour le JSON, mais `%sentStamp%`/`%receivedStamp%` sans format sont des nombres (pas de guillemets).

---

## 3. Utilisation avec Capacitor (ton cas : PWA JS encapsulée)

Principe : **le transfert reste 100 % natif** (un WebView endormi ne verrait pas le SMS). Le JS ne fait que configurer.

```bash
# 1. injecter le moteur dans le plugin
cp -r engine/tech capacitor-plugin/android/src/main/java/

# 2. construire le plugin (génère dist/)
cd capacitor-plugin && npm install && npm run build && cd ..

# 3. l'installer dans ton app Capacitor
cd /chemin/vers/ton-app
npm install /chemin/vers/sms-gateway-engine/capacitor-plugin
npx cap sync android
```

Le manifeste du plugin (receiver + permissions) est fusionné automatiquement par Gradle.

Dans ton code JS/TS :

```ts
import { SmsGateway, setRules } from 'capacitor-sms-gateway';

// Permission runtime RECEIVE_SMS (obligatoire, une fois)
const p = await SmsGateway.requestPermissions();
if (p.sms !== 'granted') throw new Error('Permission SMS refusée');

await setRules([{
  key: 'supabase-main',
  sender: '*',                    // idéalement un expéditeur précis : voir §7
  is_sender_regex: false,
  sms_filter: '',
  url: 'https://<ton-projet>.supabase.co/functions/v1/sms-inbox',
  sim_slot: 0,
  template: '{"from":"%from%","text":"%text%","sentStamp":%sentStamp%,"sim":"%sim%"}',
  headers: '{}',
  retries_number: 10,
  ignore_ssl: false,
  chunked_mode: true,
  is_sms_enabled: true,
  sign_hmac_sha256: true,
  sign_hmac_sha256_secret: '<le même secret que SMS_HMAC_SECRET>',
  store_failed: true,
  local_mode: false,
}]);
```

Méthodes exposées : `setRules` (fusion par `key`), `getRules`, `clearRules`, `checkPermissions`, `requestPermissions`.
Pour **remplacer** toute la config : `await SmsGateway.clearRules()` puis `setRules(...)`.

> Le secret HMAC finit dans l'APK/le téléphone. Traite-le comme un secret de niveau « appareil », pas comme un secret serveur. Utilise un secret par installation si tu le peux.

---

## 4. Utilisation dans un projet Android natif (Java/Kotlin)

1. Copie `engine/tech/...` dans `app/src/main/java/`.
2. `build.gradle` (module) :
   ```gradle
   implementation 'androidx.work:work-runtime:2.9.0'
   implementation 'org.apache.commons:commons-text:1.9'
   ```
3. `AndroidManifest.xml` : reprends le bloc de `capacitor-plugin/android/src/main/AndroidManifest.xml` (3 permissions + `<receiver>`).
4. Demande `RECEIVE_SMS` à l'exécution (`ActivityCompat.requestPermissions`).
5. Crée une règle (Java) :
   ```java
   ForwardingConfig c = new ForwardingConfig(context);
   c.setSender("*");
   c.setUrl("https://exemple.com/hook");
   c.setTemplate(ForwardingConfig.getDefaultJsonTemplate());
   c.setHeaders(ForwardingConfig.getDefaultJsonHeaders());
   c.setRetriesNumber(ForwardingConfig.getDefaultRetriesNumber());
   c.setIsSmsEnabled(true);
   c.save();
   ```

---

## 5. Autres frameworks (Flutter, React Native, Cordova...)

Même schéma que Capacitor : le moteur est du code Android, donc il reste dans la partie native de ton projet (module Android). Tu crées un petit pont (MethodChannel Flutter, NativeModule React Native, plugin Cordova) qui expose au minimum `setRules(json)` → `ForwardingConfig.importFromJson(...)` et `getRules()` → `exportToJson(...)`. Le receiver, lui, est déclaré dans le manifeste Android comme au §4.

---

## 6. Côté Supabase (webhook récepteur)

```bash
supabase db push                      # ou colle supabase/schema.sql dans le SQL editor
supabase secrets set SMS_HMAC_SECRET='<ton secret>'
supabase functions deploy sms-inbox --no-verify-jwt   # la signature HMAC remplace le JWT
```

L'Edge Function (`supabase/functions/sms-inbox/index.ts`) relit le **corps brut**, recalcule le HMAC, compare, puis insère dans `sms_inbox`. Elle répond 200 en cas de succès, 500 si l'insertion échoue (le moteur retentera). La table a la RLS activée sans policy : ajoute la tienne pour la lecture côté front (ou un Realtime filtré).

### Si le build échoue
- Versions Gradle/AGP/SDK : le `capacitor-plugin/android/build.gradle` est un modèle ; aligne-le sur ce que génère ta version de Capacitor (`npm init @capacitor/plugin`).
- `Class not found` sur une classe du moteur : vérifie que `cp -r engine/tech ...` a bien conservé les dossiers (y compris `SSLSocketFactory/`).
- `minSdk` : Capacitor impose le sien (22+ ou 23+), plus haut que les 14 de l'original, donc aucun souci.

---

## 7. À savoir avant de déployer

- **Google Play** : `RECEIVE_SMS` est une permission restreinte ; la publication exige une justification (ex. être l'application SMS par défaut). Hors Play Store (APK), pas de blocage.
- **Batterie** : sur Xiaomi/Huawei/Samsung/Oppo, demande à l'utilisateur d'exclure l'app de l'optimisation de batterie. Un « arrêt forcé » empêche tout receiver de se déclencher jusqu'à la prochaine ouverture de l'app.
- **Données sensibles** : les SMS contiennent des codes de connexion, des infos bancaires, des conversations privées. N'utilise pas `sender: "*"` sans raison : filtre par expéditeur ou par regex, informe l'utilisateur de ce qui est transmis, obtiens son consentement, et protège la table (RLS).
- **Licence** : MIT. Garde `LICENSE.txt` (mention de copyright de Konstantin Bogomolov) dans ce que tu livres.
