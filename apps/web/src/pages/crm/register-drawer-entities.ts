/**
 * Lazy CRM renderer registration boundary.
 *
 * Each field module registers its renderer as a module side effect. Keeping those imports in the CRM
 * composition layer prevents generic patterns/hooks from reaching into pages while retaining the
 * existing single-chunk lazy-load behavior.
 */
import './contacts/contact-fields';
import './keep-records/keep-record-fields';
import './visit-records/visit-record-fields';
import './payments/payment-fields';
import './invoices/invoice-fields';
import './opportunities/opportunity-fields';
import './sale-orders/sale-order-fields';
import './customers/customer-fields';
