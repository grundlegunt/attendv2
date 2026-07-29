import { EmailProvider, TicketReceipt } from "./email-provider";

export class TestEmailProvider implements EmailProvider {
  readonly name = "test";
  readonly sent: TicketReceipt[] = [];

  async sendTicketReceipt(receipt: TicketReceipt) {
    this.sent.push(receipt);
    return { messageId: `test-message-${this.sent.length}` };
  }
}
