export class Conversation {
  private _id: string;
  private _messages: Message[];

  constructor(id: string) {
    this._id = id;
    this._messages = [];
  }

  get id(): string {
    return this._id;
  }

  get messages(): Message[] {
    return this._messages;
  }

  addMessage(message: Message): void {
    this._messages.push(message);
  }
}

export class Message {
  constructor(
    private readonly _id: string,
    private readonly _sender: string,
    private readonly _content: string,
    private readonly _createdAt: Date = new Date(),
  ) {}

  get id() {
    return this._id;
  }

  get sender() {
    return this._sender;
  }

  get content() {
    return this._content;
  }

  get createdAt() {
    return this._createdAt;
  }
}
