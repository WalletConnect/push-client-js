import { IStore } from "@walletconnect/types";
import { IPushEngine } from "./engine";
import { IBaseClient, PushClientTypes } from "./baseClient";

export abstract class IWalletClient extends IBaseClient {
  public abstract messages: IStore<
    string,
    Record<number, PushClientTypes.PushMessage>
  >;

  constructor(public opts: PushClientTypes.WalletClientOptions) {
    super();
  }

  // ---------- Public Methods (wallet) ----------------------------------------------- //

  public abstract approve: IPushEngine["approve"];
  public abstract reject: IPushEngine["reject"];
  public abstract decryptMessage: IPushEngine["decryptMessage"];
  public abstract getMessageHistory: IPushEngine["getMessageHistory"];
}
