import { redactContactDetails } from './redact-contact';

describe('redactContactDetails', () => {
  it('hides Nigerian phone numbers', () => {
    expect(redactContactDetails('Call 08031234567').text).toBe('Call [phone hidden]');
    expect(redactContactDetails('Call +234 803 123 4567').text).toBe('Call [phone hidden]');
  });

  it('hides emails, links and social handles', () => {
    expect(redactContactDetails('Email a@b.com').text).toBe('Email [email hidden]');
    expect(redactContactDetails('See wa.me/2348031234567').text).toBe('See [link hidden]');
    expect(redactContactDetails('My handle is @hairplug').text).toBe('My handle is [social handle hidden]');
  });

  it('leaves ordinary style notes and prices alone', () => {
    expect(redactContactDetails('Waist length, ₦45,000, arrives Friday')).toEqual({ text: 'Waist length, ₦45,000, arrives Friday', redacted: false });
  });
});
