package tech.bogomolov.incomingsmsgateway;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Pont JS <-> moteur. Il ne fait QUE configurer les regles (stockees en SharedPreferences "phones").
 * La reception et l'envoi des SMS sont geres par SmsBroadcastReceiver + RequestWorker,
 * sans passer par le WebView.
 */
@CapacitorPlugin(
    name = "SmsGateway",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS }) }
)
public class SmsGatewayPlugin extends Plugin {

    @PluginMethod
    public void setRules(PluginCall call) {
        String rules = call.getString("rules");
        if (rules == null) { call.reject("rules manquant"); return; }
        try {
            int n = ForwardingConfig.importFromJson(getContext(), rules);
            JSObject ret = new JSObject();
            ret.put("imported", n);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("JSON invalide: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getRules(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("rules", ForwardingConfig.exportToJson(getContext()));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void clearRules(PluginCall call) {
        for (ForwardingConfig c : ForwardingConfig.getAll(getContext())) {
            c.remove();
        }
        call.resolve();
    }
}
