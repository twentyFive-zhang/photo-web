import type * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
} from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "./label";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = createContext<FormFieldContextValue>(
  {} as FormFieldContextValue,
);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext>
  );
}

type FormItemContextValue = {
  id: string;
};

const FormItemContext = createContext<FormItemContextValue>(
  {} as FormItemContextValue,
);

function useFormField() {
  const fieldContext = use(FormFieldContext);
  const itemContext = use(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext.name) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

function FormItem({ className, ...props }: ComponentProps<"div">) {
  const id = useId();
  return (
    <FormItemContext value={{ id }}>
      <div
        className={cn("grid gap-1.5", className)}
        data-slot="form-item"
        {...props}
      />
    </FormItemContext>
  );
}

function FormLabel({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField();
  return (
    <Label
      className={cn(error && "text-red-400", className)}
      data-slot="form-label"
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();
  return (
    <Slot
      aria-describedby={
        error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId
      }
      aria-invalid={!!error}
      data-slot="form-control"
      id={formItemId}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      className={cn("text-xs text-neutral-500", className)}
      data-slot="form-description"
      id={formDescriptionId}
      {...props}
    />
  );
}

function FormMessage({ className, children, ...props }: ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  if (!body) return null;
  return (
    <p
      className={cn("text-sm text-red-400", className)}
      data-slot="form-message"
      id={formMessageId}
      {...props}
    >
      {body as ReactNode}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
