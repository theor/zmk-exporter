import "./App.css";
import { useState } from "react";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import { create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";

function App() {
  return (
    <>
      <h1>ZMK Exporter</h1>
        <div>
              <PortView />
        </div>
    </>
  );
}

async function connect(): Promise<KeyboardData> {
  const ac = new AbortController();
  const transport = await serial_connect();
  let conn = await create_rpc_connection(transport, { signal: ac.signal });

  let details = await Promise.race([
    call_rpc(conn, { core: { getDeviceInfo: true } })
      .then((r) => r?.core?.getDeviceInfo)
      .catch((e) => {
        console.error("Failed first RPC call", e);
        return undefined;
      }),
    valueAfter(undefined, 1000),
  ]);
  console.log("details", details);
  return await getData(conn);
}

interface KeyboardData {
  physical: PhysicalLayouts;
  keymaps: BehaviorBinding[][];
}
async function getData(conn: RpcConnection) {
  let physical = (
    await call_rpc(conn, { keymap: { getPhysicalLayouts: true } })
  ).keymap?.getPhysicalLayouts ?? {activeLayoutIndex:-1,layouts:[]};

  let resp = await call_rpc(conn, { keymap: { getKeymap: true } });
  const layers = resp.keymap?.getKeymap?.layers as Layer[];

  var allBindings = layers.flatMap((l, li) =>
    l.bindings.map((b, bi) => {
      let label = undefined;
      const mods = (b.param1 >> 24) & 0xff;
      if (b.behaviorId === 4) {
        // remove mods
        const usage = b.param1 & ~(0xff << 24);
        const [page, id] = hid_usage_page_and_id_from_usage(usage);
        const labels = hid_usage_get_labels(page, id);
        // console.warn(li,bi, b.param1, page, id,labels);
        label = labels.short;
      }
      return { layer: li, binding: bi, bindingData: { ...b, label, mods } };
    })
  );
  // object with one entry per binding, where each item is an object with 1 entry per layer
  // { 0: { 0: {behaviorId: 4, ...}, 1: ...} }
  var merged = allBindings.reduce((acc: BehaviorBinding[][], b) => {
    acc[b.binding] = acc[b.binding] || [];
    acc[b.binding][b.layer] = b.bindingData;
    return acc;
  }, []);
  // console.warn(merged);
  // console.warn(JSON.stringify(merged, null, 2));

  return { physical, keymaps: merged };
}

const PortView = () => {
  const [conn, setConn] = useState<KeyboardData | undefined>(undefined);
  const copy = () => navigator
    .clipboard.writeText(JSON.stringify(conn, undefined, 2))
    .catch((e) => console.error("Failed to copy", e));
  const download = () => {
    const blob = new Blob([JSON.stringify(conn, undefined, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keyboard.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      {!conn && (
        <button
          onClick={() => {
            connect().then(setConn);
          }}
        >
          Connect
        </button>
      )}
            {conn && <div className="toolbar">
        <button onClick={copy}>Copy</button>
        <button onClick={download}>Download</button>
        </div>}
      <pre>
      {JSON.stringify(conn,undefined,2)}
      </pre>

    </div>
  );
};

export default App;

export function valueAfter<T>(val: T, ms?: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(val), ms);
  });
}

import {
  call_rpc as inner_call_rpc,
  Request,
  RequestResponse,
  RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client";
import { BehaviorBinding, Layer, PhysicalLayouts } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { hid_usage_get_labels, hid_usage_page_and_id_from_usage } from "./hid_usage";

export async function call_rpc(
  conn: RpcConnection,
  req: Omit<Request, "requestId">
): Promise<RequestResponse> {
  console.log("RPC Request", req);
  return inner_call_rpc(conn, req)
    .then((r) => {
      console.log("RPC Response", r);
      return r;
    })
    .catch((e) => {
      console.error("RPC Error", e);
      return e;
    });
}
