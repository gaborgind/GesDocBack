import nodemailer from 'nodemailer';

export const transporter = nodemailer.createTransport({
  service: 'gmail', // Al poner 'gmail', nodemailer ya sabe qué host y puerto usar
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Agregamos esto para evitar problemas de certificados:
  tls: {
    rejectUnauthorized: false
  }
});