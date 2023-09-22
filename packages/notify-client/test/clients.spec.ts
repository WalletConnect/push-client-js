import { Wallet as EthersWallet } from "@ethersproject/wallet";
import { Core, RELAYER_DEFAULT_PROTOCOL } from "@walletconnect/core";
import { formatJsonRpcRequest } from "@walletconnect/jsonrpc-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KEYSERVER_URL,
  INotifyClient,
  NotifyClient,
  NotifyClientTypes,
} from "../src/";
import { waitForEvent } from "./helpers/async";
import { gmDappMetadata } from "./helpers/mocks";
import { createNotifySubscription, sendNotifyMessage } from "./helpers/notify";
import { disconnectSocket } from "./helpers/ws";
import axios from "axios";
import { ICore } from "@walletconnect/types";

const DEFAULT_RELAY_URL = "wss://relay.walletconnect.com";

if (!process.env.TEST_PROJECT_ID) {
  throw new ReferenceError("TEST_PROJECT_ID env variable not set");
}

const hasGmSecret = typeof process.env.NOTIFY_GM_PROJECT_SECRET !== "undefined";

const projectId = process.env.TEST_PROJECT_ID;

describe("Notify", () => {
  let core: ICore;
  let wallet: INotifyClient;
  let ethersWallet: EthersWallet;
  let account: string;
  let onSign: (message: string) => Promise<string>;

  beforeEach(async () => {
    core = new Core({
      projectId,
      relayUrl: DEFAULT_RELAY_URL,
    });

    wallet = await NotifyClient.init({
      name: "testNotifyClient",
      logger: "error",
      keyserverUrl: DEFAULT_KEYSERVER_URL,
      relayUrl: DEFAULT_RELAY_URL,
      core,
      projectId,
    });

    // Set up the mock wallet account
    ethersWallet = EthersWallet.createRandom();
    account = `eip155:1:${ethersWallet.address}`;
    onSign = (message: string) => ethersWallet.signMessage(message);
  });

  afterEach(async () => {
    await disconnectSocket(wallet.core);
  });

  describe("NotifyClient", () => {
    it("can be instantiated", () => {
      expect(wallet instanceof NotifyClient).toBe(true);
      expect(wallet.core).toBeDefined();
      expect(wallet.events).toBeDefined();
      expect(wallet.logger).toBeDefined();
      expect(wallet.requests).toBeDefined();
      expect(wallet.subscriptions).toBeDefined();
      expect(wallet.core.expirer).toBeDefined();
      expect(wallet.core.history).toBeDefined();
      expect(wallet.core.pairing).toBeDefined();
    });

    describe("subscribe", () => {
      it("can issue a `notify_subscription` request and handle the response", async () => {
        let gotNotifySubscriptionResponse = false;
        let notifySubscriptionEvent: any;
        let gotNotifySubscriptionsChangedRequest = false;
        let changedSubscriptions: NotifyClientTypes.NotifySubscription[] = [];

        wallet.once("notify_subscription", (event) => {
          gotNotifySubscriptionResponse = true;
          notifySubscriptionEvent = event;
        });
        wallet.on("notify_subscriptions_changed", (event) => {
          console.log("notify_subscriptions_changed", event);
          if (event.params.subscriptions.length > 0) {
            gotNotifySubscriptionsChangedRequest = true;
            changedSubscriptions = event.params.subscriptions;
          }
        });

        await wallet.register({
          account,
          onSign,
          domain: gmDappMetadata.appDomain,
          isLimited: false,
        });

        await wallet.subscribe({
          account,
          appDomain: gmDappMetadata.appDomain,
        });

        await waitForEvent(() => gotNotifySubscriptionResponse);
        await waitForEvent(() => gotNotifySubscriptionsChangedRequest);

        // Check that wallet is in expected state.
        expect(wallet.subscriptions.keys.length).toBe(1);
        expect(wallet.subscriptions.keys[0]).toBe(
          changedSubscriptions[0].topic
        );
        expect(wallet.messages.keys.length).toBe(1);
      });
    });

    describe.skipIf(!hasGmSecret)("handling incoming notifyMessage", () => {
      it("emits a `notify_message` event when a notifyMessage is received", async () => {
        await createNotifySubscription(wallet, account, onSign);

        let gotNotifyMessageResponse = false;
        let notifyMessageEvent: any;

        wallet.once("notify_message", (event) => {
          gotNotifyMessageResponse = true;
          notifyMessageEvent = event;
        });

        const sendResponse = await sendNotifyMessage(account, "Test");

        expect(sendResponse.status).toBe(200);

        await waitForEvent(() => gotNotifyMessageResponse);

        expect(notifyMessageEvent.params.message.body).toBe("Test");
      });

      it("reads the dapp's did.json from memory after the initial fetch", async () => {
        let incomingMessageCount = 0;
        await createNotifySubscription(wallet, account, onSign);

        wallet = await NotifyClient.init({
          name: "testNotifyClient",
          logger: "error",
          keyserverUrl: DEFAULT_KEYSERVER_URL,
          relayUrl: DEFAULT_RELAY_URL,
          core,
          projectId,
        });

        wallet.on("notify_message", (event) => {
          incomingMessageCount += 1;
        });

        const axiosSpy = vi.spyOn(axios, "get");

        await sendNotifyMessage(account, "Test");
        await sendNotifyMessage(account, "Test");

        await waitForEvent(() => incomingMessageCount === 2);

        // Ensure `axios.get` was only called once to resolve the dapp's did.json
        expect(axiosSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("update", () => {
      it("can update an existing notify subscription with a new scope", async () => {
        await createNotifySubscription(wallet, account, onSign);

        let gotNotifyUpdateResponse = false;
        let notifyUpdateEvent: any;
        let gotNotifySubscriptionsChangedRequest = false;
        let lastChangedSubscriptions: NotifyClientTypes.NotifySubscription[] =
          [];

        wallet.once("notify_update", (event) => {
          gotNotifyUpdateResponse = true;
          notifyUpdateEvent = { ...event };
        });
        wallet.on("notify_subscriptions_changed", (event) => {
          console.log("notify_subscriptions_changed", event);
          gotNotifySubscriptionsChangedRequest = true;
          lastChangedSubscriptions = event.params.subscriptions;
        });

        const subscriptions = wallet.subscriptions.getAll();

        // Ensure all scopes are enabled in the initial subscription.
        expect(
          Object.values(subscriptions[0].scope)
            .map((scp) => scp.enabled)
            .every((enabled) => enabled === true)
        ).toBe(true);

        await wallet.update({
          topic: subscriptions[0].topic,
          scope: [],
        });

        await waitForEvent(() => gotNotifyUpdateResponse);
        await waitForEvent(() => gotNotifySubscriptionsChangedRequest);

        expect(gotNotifyUpdateResponse).toBe(true);
        expect(wallet.subscriptions.keys[0]).toBe(
          lastChangedSubscriptions[0].topic
        );
        // Ensure all scopes have been disabled in the updated subscription.
        expect(
          Object.values(lastChangedSubscriptions[0].scope)
            .map((scp) => scp.enabled)
            .every((enabled) => enabled === false)
        ).toBe(true);
      });
    });

    describe("decryptMessage", () => {
      it("can decrypt an encrypted message for a known notify topic", async () => {
        await createNotifySubscription(wallet, account, onSign);

        const messageClaims = {
          iat: 1691064656,
          exp: 1693656656,
          iss: "did:key:z6MksfkEMFdEWmGiy9rnyrJSxovfKZVB3sAFjVSvKw78bAR1",
          ksu: "https://keys.walletconnect.com",
          aud: "did:pkh:eip155:1:0x9667790eFCa797fFfBaC94ecBd479A8C3c22565A",
          act: "notify_message",
          sub: "00f22c1de22f8128faa0424434a8caa984e91f41bbb82c1796b75d33e9dd9f98",
          app: "https://gm.walletconnect.com",
          msg: {
            title: "Test Message",
            body: "Test",
            icon: "",
            url: "https://test.coms",
            type: "gm_hourly",
          },
        };
        const messageAuth =
          "eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSJ9.eyJpYXQiOjE2OTEwNjQ2NTEsImV4cCI6MTY5MzY1NjY1MSwiaXNzIjoiZGlkOmtleTp6Nk1rc2ZrRU1GZEVXbUdpeTlybnlySlN4b3ZmS1pWQjNzQUZqVlN2S3c3OGJBUjEiLCJrc3UiOiJodHRwczovL2tleXMud2FsbGV0Y29ubmVjdC5jb20iLCJhdWQiOiJkaWQ6cGtoOmVpcDE1NToxOjB4NTY2MkI3YTMyMzQ1ZDg0MzM2OGM2MDgzMGYzRTJiMDE1MDIyQkNFMSIsImFjdCI6Im5vdGlmeV9tZXNzYWdlIiwic3ViIjoiMDAyODY4OGMzY2ZkODYwNGRlMDgyOTdjZDQ4ZTM3NjYyYzJhMmE4MDc4MzAyYmZkNDJlZDQ1ZDkwMTE0YTQxYyIsImFwcCI6Imh0dHBzOi8vZ20ud2FsbGV0Y29ubmVjdC5jb20iLCJtc2ciOnsidGl0bGUiOiJUZXN0IE1lc3NhZ2UiLCJib2R5IjoiVGVzdCIsImljb24iOiIiLCJ1cmwiOiJodHRwczovL3Rlc3QuY29tcyIsInR5cGUiOiJnbV9ob3VybHkifX0.B2U5d6IejtRqC9I_qWnx2-AASeneX2Vtl_st8tAuoFMmBuB8r39Nr0zoslbmnyLHxt2PmEHVfzMHksFVAtrfDg";
        const topic = wallet.subscriptions.keys[0];
        const payload = formatJsonRpcRequest("wc_notifyMessage", {
          messageAuth,
        });
        const encryptedMessage = await wallet.core.crypto.encode(
          topic,
          payload
        );

        const decryptedMessage = await wallet.decryptMessage({
          topic,
          encryptedMessage,
        });

        expect(decryptedMessage).toStrictEqual(messageClaims.msg);
      });
    });

    describe("getActiveSubscriptions", () => {
      it("can query currently active notify subscriptions", async () => {
        await createNotifySubscription(wallet, account, onSign);

        const walletSubscriptions = wallet.getActiveSubscriptions();

        // Check that wallet is in expected state.
        expect(Object.keys(walletSubscriptions).length).toBe(1);
      });
      it("can filter currently active notify subscriptions", async () => {
        [1, 2].forEach((num) => {
          wallet.subscriptions.set(`topic${num}`, {
            account: `account${num}`,
            expiry: Date.now(),
            relay: {
              protocol: RELAYER_DEFAULT_PROTOCOL,
            },
            scope: {},
            metadata: gmDappMetadata,
            topic: `topic${num}`,
            symKey: "",
          });
        });

        const walletSubscriptions = wallet.getActiveSubscriptions({
          account: "account2",
        });

        expect(Object.keys(walletSubscriptions).length).toBe(1);
        expect(
          Object.values(walletSubscriptions).map((sub) => sub.account)
        ).toEqual(["account2"]);
      });
    });

    describe("getMessageHistory", async () => {
      it("can get message history for a known notify topic", async () => {
        await createNotifySubscription(wallet, account, onSign);
        const [subscription] = wallet.subscriptions.getAll();
        const { topic } = subscription;
        const message1 = {
          title: "Test Notify 1",
          body: "This is a test notify notification",
          icon: "xyz.png",
          url: "https://walletconnect.com",
        };
        const message2 = {
          title: "Test Notify 2",
          body: "This is a test notify notification",
          icon: "xyz.png",
          url: "https://walletconnect.com",
        };

        wallet.messages.set(topic, {
          topic,
          messages: {
            "1685014464223153": {
              id: 1685014464223153,
              topic:
                "a185fd51f0a9a4d1fb4fffb4129480a8779d6c8f549cbbac3a0cfefd8788cd5d",
              message: message1,
              publishedAt: 1685014464322,
            },
            "1685014464326223": {
              id: 1685014464326223,
              topic:
                "a185fd51f0a9a4d1fb4fffb4129480a8779d6c8f549cbbac3a0cfefd8788cd5d",
              message: message2,
              publishedAt: 1685014464426,
            },
          },
        });

        const messageHistory = wallet.getMessageHistory({ topic });
        const sortedHistory = Object.values(messageHistory).sort(
          (a, b) => a.publishedAt - b.publishedAt
        );

        expect(sortedHistory.length).toBe(2);
        expect(sortedHistory[0].id).toBeDefined();
        expect(sortedHistory[0].topic).toBeDefined();
        expect(sortedHistory[0].publishedAt).toBeDefined();
        expect(sortedHistory.map(({ message }) => message)).to.deep.equal([
          message1,
          message2,
        ]);
      });
    });

    describe("deleteSubscription", () => {
      it("can delete a currently active notify subscription", async () => {
        let gotNotifySubscriptionsChanged = false;
        let gotNotifySubscriptionsChangedEvent: any;

        await createNotifySubscription(wallet, account, onSign);

        expect(Object.keys(wallet.getActiveSubscriptions()).length).toBe(1);

        const walletSubscriptionTopic = Object.keys(
          wallet.getActiveSubscriptions()
        )[0];

        wallet.once("notify_subscriptions_changed", (event) => {
          gotNotifySubscriptionsChanged = true;
          gotNotifySubscriptionsChangedEvent = event;
        });

        await wallet.deleteSubscription({ topic: walletSubscriptionTopic });

        await waitForEvent(() => gotNotifySubscriptionsChanged);

        console.log(gotNotifySubscriptionsChangedEvent);

        // Check that wallet is in expected state.
        expect(Object.keys(wallet.getActiveSubscriptions()).length).toBe(0);
        expect(wallet.messages.keys.length).toBe(0);
      });
    });

    describe("deleteNotifyMessage", async () => {
      it("deletes the notify message associated with the provided `id`", async () => {
        await createNotifySubscription(wallet, account, onSign);
        const [subscription] = wallet.subscriptions.getAll();
        const { topic } = subscription;
        const message = {
          title: "Test Notify",
          body: "This is a test notify notification",
          icon: "xyz.png",
          url: "https://walletconnect.com",
        };

        wallet.messages.set(topic, {
          topic,
          messages: {
            "1685014464223153": {
              id: 1685014464223153,
              topic:
                "a185fd51f0a9a4d1fb4fffb4129480a8779d6c8f549cbbac3a0cfefd8788cd5d",
              message,
              publishedAt: 1685014464322,
            },
          },
        });

        const messages = Object.values(wallet.messages.get(topic).messages);

        expect(messages.length).toBe(1);

        const targetMessageId = messages[0].id;
        wallet.deleteNotifyMessage({ id: targetMessageId });

        expect(Object.values(wallet.messages.get(topic).messages).length).toBe(
          0
        );
      });
    });

    describe("watchSubscriptions", () => {
      it("fires correct event update", async () => {
        let updateEvent: any = {};
        let gotNotifyUpdateResponse = false;
        let updatedCount = 0;

        wallet.on("notify_subscriptions_changed", (event) => {
          updatedCount += 1;
        });

        await createNotifySubscription(wallet, account, onSign);

        expect(wallet.subscriptions.keys.length).toBe(1);

        const subscriptions = wallet.subscriptions.getAll();

        wallet.once("notify_update", (event) => {
          gotNotifyUpdateResponse = true;
          updateEvent = event;
        });

        await wallet.update({
          topic: subscriptions[0].topic,
          scope: [""],
        });

        await waitForEvent(() => gotNotifyUpdateResponse);
        await waitForEvent(() => updatedCount === 3);

        expect(updateEvent.topic).toBe(subscriptions[0].topic);
      });

      it("handles multiple subscriptions", async () => {
        const wallet1 = await NotifyClient.init({
          name: "testNotifyClient1",
          logger: "error",
          keyserverUrl: DEFAULT_KEYSERVER_URL,
          relayUrl: DEFAULT_RELAY_URL,
          core,
          projectId,
        });

        let wallet1UpdateCount = 0;

        wallet1.on("notify_subscriptions_changed", (params) => {
          wallet1UpdateCount++;
        });
        await createNotifySubscription(wallet, account, onSign);

        await createNotifySubscription(wallet, account, onSign, true);

        await waitForEvent(() => {
          return wallet1UpdateCount > 2;
        });

        const wallet2 = await NotifyClient.init({
          name: "debug_me",
          logger: "info",
          keyserverUrl: DEFAULT_KEYSERVER_URL,
          relayUrl: DEFAULT_RELAY_URL,
          core: new Core({ projectId, relayUrl: DEFAULT_RELAY_URL }),
          projectId,
        });

        let wallet2GotUpdate = false;
        wallet2.on("notify_subscriptions_changed", () => {
          wallet2GotUpdate = true;
        });

        await wallet2.register({
          account,
          onSign,
          isLimited: false,
          domain: "unrelated.domain.com",
        });

        await waitForEvent(() => {
          return wallet2GotUpdate;
        });

        expect(wallet1.subscriptions.getAll().length).toEqual(
          wallet2.subscriptions.getAll().length
        );
      });
    });
  });
});
