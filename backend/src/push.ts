// Envío de avisos al teléfono del adulto. El aviso siempre queda en la tabla `avisos`;
// el proveedor solo decide si además llega como push.

export interface Aviso {
  id: string;
  tipo: string;
  texto: string;
}

export interface Push {
  nombre: string;
  enviar(pushToken: string | null, aviso: Aviso): Promise<boolean>;
}

/** Sin FCM: no manda nada, la app del adulto lee /v1/adultos/avisos. */
export const pushDeRegistro: Push = {
  nombre: "registro",
  async enviar() {
    return false;
  },
};

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** FCM HTTP v1. Se activa sola cuando existe FCM_SERVICE_ACCOUNT. */
export function pushFcm(serviceAccountJson: string): Push {
  const cuenta = JSON.parse(serviceAccountJson) as ServiceAccount;
  let clientePromesa: Promise<{ getAccessToken(): Promise<{ token?: string | null }> }> | null = null;

  async function cliente() {
    clientePromesa ??= import("google-auth-library").then(({ JWT }) =>
      new JWT({
        email: cuenta.client_email,
        key: cuenta.private_key,
        scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
      }),
    );
    return clientePromesa;
  }

  return {
    nombre: "fcm",
    async enviar(pushToken, aviso) {
      if (!pushToken) return false;
      const { token } = await (await cliente()).getAccessToken();
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: pushToken,
            notification: { title: "Órbita", body: aviso.texto },
            data: { tipo: aviso.tipo, aviso_id: aviso.id },
          },
        }),
      });
      return r.ok;
    },
  };
}

export function crearPush(serviceAccountJson: string | undefined): Push {
  return serviceAccountJson ? pushFcm(serviceAccountJson) : pushDeRegistro;
}
