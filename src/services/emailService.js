import emailjs from '@emailjs/browser';

const EMAILJS_SERVICE_ID = 'service_rnx73od';
const EMAILJS_TEMPLATE_ID = 'template_ek77dzf';
const EMAILJS_PUBLIC_KEY = 'LOoL0ruuQv9akTtU1';

export const emailService = {
  /**
   * Send welcome email to newly registered Google user via EmailJS
   */
  async sendWelcomeEmail(user) {
    if (!user || !user.email) {
      console.warn('EmailJS: No valid recipient email provided');
      return { success: false, reason: 'No email' };
    }

    try {
      emailjs.init(EMAILJS_PUBLIC_KEY);

      const templateParams = {
        to_name: user.displayName || 'Valued Creator',
        to_email: user.email,
        app_name: 'Zulora AI',
        founder_name: 'Shiven Panwar',
        support_email: 'zulora.help@gmail.com',
        whatsapp_helpline: '+91 6395211325'
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
      return { success: false, error: error.message || error };
    }
  }
};

export default emailService;

