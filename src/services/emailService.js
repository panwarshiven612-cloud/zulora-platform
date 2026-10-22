import emailjs from '@emailjs/browser';

const EMAILJS_SERVICE_ID = 'service_rnx73od';
const EMAILJS_TEMPLATE_ID = 'template_5fpxcds';
const EMAILJS_PUBLIC_KEY = 'LOoL0ruuQv9akTtU1';

export const emailService = {
  /**
   * Send automated welcome email to newly registered user via EmailJS
   */
  async sendWelcomeEmail(user) {
    const recipientEmail = user?.email || user?.to_email;
    if (!recipientEmail) {
      console.warn('EmailJS: No valid recipient email provided');
      return { success: false, reason: 'No email' };
    }

    try {
      emailjs.init(EMAILJS_PUBLIC_KEY);

      const templateParams = {
        to_name: user.displayName || 'Valued Creator',
        to_email: recipientEmail,
        email: recipientEmail, // Target Email field: {{email}}
        user_email: recipientEmail,
        recipient_email: recipientEmail,
        reply_to: 'zulora.help@gmail.com',
        from_email: 'zulora.help@gmail.com',
        sender_email: 'zulora.help@gmail.com',
        app_name: 'Zulora AI',
        founder_name: 'Shiven Panwar',
        support_email: 'zulora.help@gmail.com',
        whatsapp_helpline: '+91 6395211325',
        welcome_message: 'Thank you for joining Zulora AI (zulora.in)! We are thrilled to welcome you to the next generation of creative and productive AI. Explore AI Chat, Video Studio, Image Studio, AI Brain, and more.',
        message: 'Thank you for joining Zulora AI (zulora.in)! Your creative workspace is ready.'
      };

      const response = await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        templateParams,
        EMAILJS_PUBLIC_KEY
      );

      console.log('EmailJS welcome email sent successfully:', response.status, response.text);
      return { success: true, response };
    } catch (error) {
      console.error('EmailJS sendWelcomeEmail error:', error);
      return { success: false, error: error?.message || error };
    }
  }
};

export default emailService;
