import {
  ErrorResponse,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcResult,
} from "@walletconnect/jsonrpc-utils";
import { CryptoTypes } from "@walletconnect/types";
import { INotifyClient, NotifyClientTypes } from "./client";
import { JsonRpcTypes } from "./jsonrpc";
import EventEmitter from "events";

export interface RpcOpts {
  req: { ttl: number; tag: number };
  res: { ttl: number; tag: number };
}

export declare namespace NotifyEngineTypes {
  interface EventCallback<T extends JsonRpcRequest | JsonRpcResponse> {
    topic: string;
    payload: T;
    publishedAt: number;
  }

  type EventError = {
      hasError: true;
      error: string
    }

  type EventOrError<T> = (T & { hasError: false }) | EventError

  type Event =
    | "notify_get_notifications_response"
    | "notify_get_notification_response"
    | "notify_get_unread_notifications_count_response"

  interface EventArguments {
    notify_get_notifications_response: EventOrError<{
      notifications: NotifyClientTypes.NotifyMessage[]
      hasMore: boolean
      hasMoreUnread: boolean
    }>

    notify_get_notification_response: EventOrError<{
      notification: NotifyClientTypes.NotifyMessage
    }>

    notify_get_unread_notifications_count_response: EventOrError<{
      count: number
    }>
  }
}

export abstract class INotifyEngine {
  constructor(public client: INotifyClient) {}

  public abstract init(): Promise<void>;

  // ---------- Public Methods ------------------------------------------ //

  public abstract prepareRegistration(params: {
    account: string;
    domain: string;
    allApps?: boolean;
  }): Promise<{
    registerParams: NotifyClientTypes.NotifyRegistrationParams;
    message: string;
  }>;

  public abstract register(params: {
    registerParams: NotifyClientTypes.NotifyRegistrationParams;
    signature: string;
  }): Promise<string>;

  public abstract isRegistered(params: {
    account: string;
    allApps?: boolean;
    domain: string;
  }): boolean;

  public abstract unregister(params: { account: string }): Promise<void>;

  public abstract subscribe(params: {
    appDomain: string;
    account: string;
  }): Promise<{ id: number; subscriptionAuth: string }>;

  public abstract update(params: {
    topic: string;
    scope: string[];
  }): Promise<boolean>;

  // decrypt notify subscription message
  public abstract decryptMessage(params: {
    topic: string;
    encryptedMessage: string;
  }): Promise<NotifyClientTypes.NotifyMessage>;

  // get all messages for a subscription
  public abstract getNotificationHistory(params: {
    topic: string;
    limit?: number;
    startingAfter?: string
    unreadFirst: boolean
  }): Promise<{
    notifications: NotifyClientTypes.NotifyMessage[],
    hasMore: boolean,
    hasMoreUnread: boolean,
  }>;

  // get notification by ID
  public abstract getNotification(params: {
    topic: string,
    id: string,
  }): Promise<NotifyClientTypes.NotifyMessage>

  // mark notification as read
  public abstract markNotificationsAsRead(params: {
    topic: string,
    ids: string[],
  }): Promise<void>

  // returns how many notifications are unread
  public abstract getUnreadNotificationsCount(params: {
    topic: string,
  }): Promise<number>

  // delete active subscription
  public abstract deleteSubscription(params: { topic: string }): Promise<void>;

  // ---------- Public Methods ------------------------------------------ //

  // query all active subscriptions
  public abstract getActiveSubscriptions(params?: {
    account: string;
  }): Record<string, NotifyClientTypes.NotifySubscription>;

  // ---------- Protected Helpers --------------------------------------- //

  protected abstract sendRequest<M extends JsonRpcTypes.WcMethod>(
    topic: string,
    method: M,
    params: JsonRpcTypes.RequestParams[M],
    encodeOpts?: CryptoTypes.EncodeOptions
  ): Promise<number>;

  protected abstract sendResult<M extends JsonRpcTypes.WcMethod>(
    id: number,
    topic: string,
    result: JsonRpcTypes.Results[M],
    encodeOpts?: CryptoTypes.EncodeOptions
  ): Promise<number>;

  protected abstract sendError(
    id: number,
    topic: string,
    error: ErrorResponse,
    opts?: CryptoTypes.EncodeOptions
  ): Promise<number>;

  // ---------- Protected Relay Event Methods ----------------------------------- //

  protected abstract onRelayEventRequest(
    event: NotifyEngineTypes.EventCallback<JsonRpcRequest>
  ): void;

  protected abstract onRelayEventResponse(
    event: NotifyEngineTypes.EventCallback<JsonRpcResponse>
  ): Promise<void>;

  // ---------- Protected Relay Event Handlers --------------------------------- //

  protected abstract onNotifySubscribeResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifySubscribe"]>
      | JsonRpcError
  ): Promise<void>;

  protected abstract onNotifyMessageRequest(
    topic: string,
    payload: JsonRpcRequest<JsonRpcTypes.RequestParams["wc_notifyMessage"]>,
    publishedAt: number
  ): Promise<void>;

  protected abstract onNotifyMessageResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyMessage"]>
      | JsonRpcError
  ): void;

  protected abstract onNotifyDeleteRequest(
    topic: string,
    payload: JsonRpcRequest<JsonRpcTypes.RequestParams["wc_notifyDelete"]>
  ): Promise<void>;

  protected abstract onNotifyDeleteResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyDelete"]>
      | JsonRpcError
  ): void;

  protected abstract onNotifyWatchSubscriptionsResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyWatchSubscription"]>
      | JsonRpcError
  ): Promise<void>;

  protected abstract onNotifySubscriptionsChangedRequest(
    topic: string,
    payload: JsonRpcRequest<
      JsonRpcTypes.RequestParams["wc_notifySubscriptionsChanged"]
    >
  ): Promise<void>;

  protected abstract onNotifyUpdateResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyUpdate"]>
      | JsonRpcError
  ): Promise<void>;

  protected abstract onNotifyGetNotificationsResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyGetNotifications"]>
      | JsonRpcError
  ): Promise<void>;

  protected abstract onNotifyGetNotificationResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyGetNotifications"]>
      | JsonRpcError
  ): Promise<void>;

  protected abstract onNotifyGetUnreadNotificationsCountResponse(
    topic: string,
    payload:
      | JsonRpcResult<JsonRpcTypes.Results["wc_notifyGetUnreadNotificationsCount"]>
      | JsonRpcError
  ): Promise<void>;

  public abstract on: <E extends NotifyEngineTypes.Event>(
    event: E,
    listener: (args: NotifyEngineTypes.EventArguments[E]) => void
  ) => EventEmitter;

  public abstract once: <E extends NotifyEngineTypes.Event>(
    event: E,
    listener: (args: NotifyEngineTypes.EventArguments[E]) => void
  ) => EventEmitter;

  public abstract off: <E extends NotifyEngineTypes.Event>(
    event: E,
    listener: (args: NotifyEngineTypes.EventArguments[E]) => void
  ) => EventEmitter;

  public abstract emit: <E extends NotifyEngineTypes.Event>(
    event: E,
    args: NotifyEngineTypes.EventArguments[E]
  ) => boolean;
}
